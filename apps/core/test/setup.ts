import { mkdirSync } from 'node:fs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { RedisMemoryServer } from 'redis-memory-server'

import {
  DATA_DIR,
  LOG_DIR,
  STATIC_FILE_DIR,
  TEMP_DIR,
  THEME_DIR,
  USER_ASSET_DIR,
} from '~/constants/path.constant'

export async function setup() {
  mkdirSync(DATA_DIR, { recursive: true })
  mkdirSync(TEMP_DIR, { recursive: true })
  mkdirSync(LOG_DIR, { recursive: true })
  mkdirSync(USER_ASSET_DIR, { recursive: true })
  mkdirSync(STATIC_FILE_DIR, { recursive: true })
  mkdirSync(THEME_DIR, { recursive: true })

  // 在CI环境中验证外部服务可用性，本地环境测试Memory Server
  if (process.env.CI || process.env.SKIP_REDIS_MEMORY_SERVER) {
    console.warn('CI environment detected, validating external services')
    
    // 验证外部Redis服务连接
    try {
      const IORedis = (await import('ioredis')).default
      const redis = new IORedis(6379, 'localhost')
      await redis.ping()
      await redis.quit()
      console.log('✅ External Redis service validation passed')
    } catch (error) {
      console.error('❌ External Redis service validation failed:', error)
      throw error
    }
    
    // 验证MongoDB Memory Server
    try {
      const db = await MongoMemoryServer.create()
      await db.stop()
      console.log('✅ MongoDB Memory Server validation passed')
    } catch (error) {
      console.warn('Failed to initialize MongoDB mock server:', error)
    }
    return
  }

  // 本地环境：Initialize Redis and MongoDB mock server
  try {
    await Promise.all([
      RedisMemoryServer.create(),
      MongoMemoryServer.create(),
    ]).then(async ([redis, db]) => {
      await redis.stop()
      await db.stop()
    })
    console.log('✅ Memory servers validation passed')
  } catch (error) {
    console.warn('Failed to initialize mock servers:', error)
    throw error
  }
}
export async function teardown() {}
