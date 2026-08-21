// FIT 解码 + 标准化（移植 web 端 fitDecoder + normalizer + calculator 算法）。
// 纯离线：在逻辑层（主线程）运行 @garmin/fitsdk（已转 CJS，见 scripts/sync-fitsdk.mjs）。
//
// 入口：decodeAndNormalize(arrayBuffer, meta) → { activity, records, errors }
//   activity：与作者快照摘要同构的汇总对象（可直接进列表 / 详情）
//   records：逐点记录（timestamp/latitude/longitude/altitude/distance/speed/heartRate/cadence/power/temperature）
//
// 注意：必须先require polyfill 以保证 TextDecoder 存在，再 require fitsdk。
require('./textDecoderPolyfill.js');
const { Decoder, Stream } = require('../vendor/fitsdk/index.js');

const SEMICIRCLE_TO_DEGREES = 180 / 2147483648;

function toUnixSeconds(v) {
  if (v instanceof Date) return Math.floor(v.getTime() / 1000);
  if (typeof v === 'number') return v;
  return undefined;
}
function asNumber(v) {
  if (typeof v !== 'number' || !isFinite(v)) return undefined;
  return v;
}
function toDegrees(s) {
  if (s === undefined || s === 0) return undefined;
  return s * SEMICIRCLE_TO_DEGREES;
}
function toIso(unix) {
  if (unix === undefined || unix <= 0) return '';
  return new Date(unix * 1000).toISOString();
}

function asRawMesg(m) {
  return {
    timestamp: toUnixSeconds(m.timestamp),
    positionLat: asNumber(m.positionLat),
    positionLong: asNumber(m.positionLong),
    distance: asNumber(m.distance),
    speed: asNumber(m.speed),
    enhancedSpeed: asNumber(m.enhancedSpeed),
    altitude: asNumber(m.altitude),
    enhancedAltitude: asNumber(m.enhancedAltitude),
    heartRate: asNumber(m.heartRate),
    cadence: asNumber(m.cadence),
    power: asNumber(m.power),
    temperature: asNumber(m.temperature),
  };
}

// ===== calculator：从记录计算汇总（与 web 端算法一致）=====
function recordsDuration(records) {
  const first = records[0].timestamp;
  const last = records[records.length - 1].timestamp;
  return Math.max(0, last - first);
}
function lastDistance(records) {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].distance !== undefined) return records[i].distance;
  }
  return undefined;
}
function estimateDistance(records) {
  let distance = 0;
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const speed = prev.speed ?? 0;
    const delta = records[i].timestamp - prev.timestamp;
    if (delta > 0) distance += speed * delta;
  }
  return distance;
}
function calculateElevationGain(records) {
  let gain = 0;
  let prev;
  for (const r of records) {
    if (r.altitude === undefined) continue;
    if (prev !== undefined && r.altitude > prev) gain += r.altitude - prev;
    prev = r.altitude;
  }
  return gain;
}
function calculateElevationLoss(records) {
  let loss = 0;
  let prev;
  for (const r of records) {
    if (r.altitude === undefined) continue;
    if (prev !== undefined && r.altitude < prev) loss += prev - r.altitude;
    prev = r.altitude;
  }
  return loss > 0 ? loss : undefined;
}
function averageOf(values) {
  const valid = values.filter((v) => v !== undefined);
  if (!valid.length) return undefined;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}
function maxOf(values) {
  const valid = values.filter((v) => v !== undefined);
  if (!valid.length) return undefined;
  return Math.max.apply(null, valid);
}
function calculateSummary(records, session) {
  if (!records.length) {
    return { duration: 0, elapsedTime: 0, distance: 0, elevationGain: 0 };
  }
  const duration = session && session.totalTimerTime != null ? session.totalTimerTime : recordsDuration(records);
  const elapsedTime = session && session.totalElapsedTime != null ? session.totalElapsedTime : duration;
  const distance = lastDistance(records) != null ? lastDistance(records) : estimateDistance(records);
  const avgSpeed = duration > 0 && distance > 0 ? distance / duration : undefined;
  return {
    duration,
    elapsedTime,
    distance,
    elevationGain: calculateElevationGain(records),
    elevationLoss: calculateElevationLoss(records),
    calories: session ? session.totalCalories : undefined,
    avgSpeed,
    maxSpeed: maxOf(records.map((r) => r.speed)),
    avgHeartRate: averageOf(records.map((r) => r.heartRate)),
    maxHeartRate: maxOf(records.map((r) => r.heartRate)),
    avgCadence: averageOf(records.map((r) => r.cadence)),
    maxCadence: maxOf(records.map((r) => r.cadence)),
    avgPower: averageOf(records.map((r) => r.power)),
    maxPower: maxOf(records.map((r) => r.power)),
  };
}

/**
 * 解码并标准化一个 FIT 文件。
 * @param {ArrayBuffer} arrayBuffer FIT 文件二进制
 * @param {{id:string,fileName:string,fingerprint:string,name:string}} meta
 */
function decodeAndNormalize(arrayBuffer, meta) {
  let buf = arrayBuffer;
  if (buf instanceof Uint8Array) buf = buf.buffer;

  const stream = Stream.fromArrayBuffer(buf);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) {
    const err = new Error('NOT_FIT_FILE');
    err.code = 'NOT_FIT_FILE';
    throw err;
  }
  if (!decoder.checkIntegrity()) {
    const err = new Error('CORRUPTED_FIT');
    err.code = 'CORRUPTED_FIT';
    throw err;
  }

  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
  });

  const rawRecords = (messages.recordMesgs || [])
    .map(asRawMesg)
    .filter((r) => r.timestamp !== undefined);

  const sessions = (messages.sessionMesgs || []).map((s) => ({
    timestamp: toUnixSeconds(s.timestamp) || 0,
    startTime: toUnixSeconds(s.startTime) || 0,
    totalElapsedTime: asNumber(s.totalElapsedTime),
    totalTimerTime: asNumber(s.totalTimerTime),
    totalDistance: asNumber(s.totalDistance),
    totalAscent: asNumber(s.totalAscent),
    totalDescent: asNumber(s.totalDescent),
    totalCalories: asNumber(s.totalCalories),
    avgSpeed: asNumber(s.avgSpeed),
    maxSpeed: asNumber(s.maxSpeed),
    avgHeartRate: asNumber(s.avgHeartRate),
    maxHeartRate: asNumber(s.maxHeartRate),
    avgCadence: asNumber(s.avgCadence),
    maxCadence: asNumber(s.maxCadence),
    avgPower: asNumber(s.avgPower),
    maxPower: asNumber(s.maxPower),
    sport: typeof s.sport === 'string' ? s.sport : undefined,
    subSport: typeof s.subSport === 'string' ? s.subSport : undefined,
    sportProfileName: typeof s.sportProfileName === 'string' ? s.sportProfileName : undefined,
  }));

  const session = sessions[0];
  const records = rawRecords.map((r) => ({
    timestamp: r.timestamp,
    latitude: toDegrees(r.positionLat),
    longitude: toDegrees(r.positionLong),
    altitude: r.altitude != null ? r.altitude : r.enhancedAltitude,
    distance: r.distance,
    speed: r.speed != null ? r.speed : r.enhancedSpeed,
    heartRate: r.heartRate,
    cadence: r.cadence,
    power: r.power,
    temperature: r.temperature,
  }));

  const summary = calculateSummary(records, session);
  const activity = {
    id: meta.id,
    fileId: meta.id,
    fileName: meta.fileName,
    fingerprint: meta.fingerprint,
    name: meta.name,
    activityType: (session && session.sport) || '',
    startTime: toIso(session ? session.startTime : records[0] && records[0].timestamp),
    endTime: toIso(session ? session.timestamp : records[records.length - 1] && records[records.length - 1].timestamp),
    duration: summary.duration,
    elapsedTime: summary.elapsedTime,
    distance: summary.distance,
    elevationGain: summary.elevationGain,
    elevationLoss: summary.elevationLoss,
    calories: summary.calories,
    avgSpeed: summary.avgSpeed,
    maxSpeed: summary.maxSpeed,
    avgHeartRate: summary.avgHeartRate,
    maxHeartRate: summary.maxHeartRate,
    avgCadence: summary.avgCadence,
    maxCadence: summary.maxCadence,
    avgPower: summary.avgPower,
    maxPower: summary.maxPower,
    device: undefined,
  };

  return { activity, records, errors: errors || [] };
}

module.exports = { decodeAndNormalize, calculateSummary };
