import log from 'electron-log/main'

/**
 * App logger (userData/logs). Paths are fine to log; file contents, excerpts and keys never are.
 */
export function initLog(dir: string, level: 'error' | 'info' | 'debug'): void {
  log.transports.file.resolvePathFn = () => `${dir}/main.log`
  log.transports.file.level = level
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.console.level = process.env['NODE_ENV'] === 'production' ? false : level
  log.errorHandler.startCatching({ showDialog: false })
}

export function setLogLevel(level: 'error' | 'info' | 'debug'): void {
  log.transports.file.level = level
}

export { log }
