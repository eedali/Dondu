/// <reference types="electron-vite/node" />

declare module '*.sql?raw' {
  const sql: string
  export default sql
}
