/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** 构建时注入的应用版本号（vite define 注入，取自 package.json version） */
declare const __APP_VERSION__: string
