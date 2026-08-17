/**
 * 合成 FIT 测试样例生成脚本。
 *
 * 官方公开样例（garmin/fit-javascript-sdk、Garmin FitSDK examples）均不含
 * GPS 位置数据，因此用官方 Encoder 合成带 GPS 轨迹的骑行样例。
 * 位置数据为虚构路线（北京近郊绕圈），非任何真实骑行记录。
 *
 * 运行：node tests/fixtures/generate-samples.mjs
 * 产出：cycling-gps.fit（全字段）、power-only.fit（有功率无心率）
 */
import { Encoder, Profile } from '@garmin/fitsdk'
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url))
// FIT 协议时间基准为 1989-12-31T00:00:00Z，文件内存储相对该基准的秒数。
// Encoder 原样写入传入值，Decoder 解码时加回偏移，因此生成侧需先减偏移。
const FIT_EPOCH_OFFSET = 631065600
const START_TIME = 1735689600 - FIT_EPOCH_OFFSET // FIT 秒，对应 2025-01-01T00:00:00Z
const START_LAT = 39.9042 // 北京天安门附近（虚构路线起点）
const START_LNG = 116.4074
const POINT_COUNT = 120
const POINT_INTERVAL = 5 // 每点间隔秒数

/**
 * 半周转整数：FIT 协议 positionLat/positionLong 以半周（semicircles）存储。
 */
function toSemicircles(degrees) {
  return Math.round((degrees * 2147483648) / 180)
}

/**
 * 生成一条绕圈路线的轨迹点。
 */
function buildRoutePoints({ withHeartRate, withPower, withCadence }) {
  const points = []
  for (let i = 0; i < POINT_COUNT; i++) {
    // 绕圈路线：先向北再折返，带轻微正弦波动
    const t = i / POINT_COUNT
    const lat = START_LAT + Math.sin(t * Math.PI * 2) * 0.012
    const lng = START_LNG + (1 - Math.cos(t * Math.PI * 2)) * 0.009
    points.push({
      timestamp: START_TIME + i * POINT_INTERVAL,
      lat,
      lng,
      distance: i * 21.5, // 累计距离（米），每点约 21.5 米
      speed: 7.2 + Math.sin(i / 10) * 1.8, // 平均约 26 km/h
      altitude: 42 + Math.sin(t * Math.PI * 4) * 18 + Math.sin(i / 6) * 2,
      heartRate: withHeartRate ? 132 + Math.sin(i / 14) * 18 : undefined,
      cadence: withCadence ? 86 + Math.sin(i / 11) * 4 : undefined,
      power: withPower ? 208 + Math.sin(i / 7) * 46 : undefined,
    })
  }
  return points
}

/**
 * 写入 fileId / deviceInfo / lap / session / activity 消息。
 */
function writeMetaMessages(encoder, { sport, withHeartRate, withPower }) {
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: 'activity',
    manufacturer: 'development',
    product: 0,
    timeCreated: START_TIME,
    serialNumber: 42420001,
  })
  encoder.onMesg(Profile.MesgNum.DEVICE_INFO, {
    timestamp: START_TIME,
    deviceIndex: 'creator',
    manufacturer: 'development',
    product: 0,
    productName: 'Cycling Analyzer Test Device',
    serialNumber: 42420001,
  })
  encoder.onMesg(Profile.MesgNum.LAP, {
    messageIndex: 0,
    timestamp: START_TIME + POINT_COUNT * POINT_INTERVAL,
    startTime: START_TIME,
    totalElapsedTime: POINT_COUNT * POINT_INTERVAL,
    totalTimerTime: POINT_COUNT * POINT_INTERVAL,
    totalDistance: POINT_COUNT * 21.5,
    sport,
    subSport: 'generic',
  })
  encoder.onMesg(Profile.MesgNum.SESSION, {
    messageIndex: 0,
    timestamp: START_TIME + POINT_COUNT * POINT_INTERVAL,
    startTime: START_TIME,
    totalElapsedTime: POINT_COUNT * POINT_INTERVAL,
    totalTimerTime: POINT_COUNT * POINT_INTERVAL,
    totalDistance: POINT_COUNT * 21.5,
    totalAscent: 78.4,
    totalDescent: 78.4,
    avgSpeed: 4.3,
    maxSpeed: 9.0,
    avgHeartRate: withHeartRate ? 132 : undefined,
    maxHeartRate: withHeartRate ? 150 : undefined,
    avgPower: withPower ? 208 : undefined,
    maxPower: withPower ? 254 : undefined,
    totalCalories: withHeartRate ? 456 : undefined,
    sport,
    subSport: 'generic',
    numLaps: 1,
  })
  encoder.onMesg(Profile.MesgNum.ACTIVITY, {
    timestamp: START_TIME + POINT_COUNT * POINT_INTERVAL,
    numSessions: 1,
    totalTimerTime: POINT_COUNT * POINT_INTERVAL,
    localTimestamp: START_TIME,
  })
}

/**
 * 生成一个 FIT 样例文件。
 */
function generateSample(fileName, options) {
  const encoder = new Encoder()
  writeMetaMessages(encoder, options)
  for (const point of buildRoutePoints(options)) {
    encoder.onMesg(Profile.MesgNum.RECORD, {
      timestamp: point.timestamp,
      positionLat: toSemicircles(point.lat),
      positionLong: toSemicircles(point.lng),
      distance: point.distance,
      speed: point.speed,
      enhancedSpeed: point.speed,
      altitude: point.altitude,
      enhancedAltitude: point.altitude,
      heartRate: point.heartRate,
      cadence: point.cadence,
      power: point.power,
    })
  }
  writeFileSync(join(FIXTURES_DIR, fileName), encoder.close())
  console.log(`已生成 ${fileName}`)
}

generateSample('cycling-gps.fit', {
  sport: 'cycling',
  withHeartRate: true,
  withPower: true,
  withCadence: true,
})

generateSample('power-only.fit', {
  sport: 'cycling',
  withHeartRate: false,
  withPower: true,
  withCadence: false,
})
