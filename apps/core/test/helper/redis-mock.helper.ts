import IORedis from 'ioredis'
import RedisMemoryServer from 'redis-memory-server'
import type { Redis } from 'ioredis'

import { CacheService } from '~/processors/redis/cache.service'

export class MockCacheService {
  private client: Redis
  constructor(port: number, host: string) {
    this.client = new IORedis(port, host)
  }

  private get redisClient() {
    return this.client
  }

  public get(key) {
    return this.client.get(key)
  }

  public set(key, value: any) {
    return this.client.set(key, value)
  }

  public getClient() {
    return this.redisClient
  }
}

const createMockRedis = async () => {
  // 在CI环境中使用真实的Redis服务
  if (process.env.CI || process.env.SKIP_REDIS_MEMORY_SERVER) {
    console.warn('Using external Redis service in CI environment')
    // 连接CI环境中的Redis服务（默认localhost:6379）
    const cacheService = new MockCacheService(6379, 'localhost')
    
    return {
      connect: () => null,
      CacheService: cacheService,
      RedisService: cacheService,
      token: CacheService,
      async close() {
        await cacheService.getClient().flushall()
        await cacheService.getClient().quit()
      },
    }
  }

  const redisServer = new RedisMemoryServer({})

  const redisHost = await redisServer.getHost()
  const redisPort = await redisServer.getPort()

  const cacheService = new MockCacheService(redisPort, redisHost)

  return {
    connect: () => null,
    CacheService: cacheService,
    RedisService: cacheService,

    token: CacheService,

    async close() {
      await cacheService.getClient().flushall()
      await cacheService.getClient().quit()
      await redisServer.stop()
    },
  }
}

export const redisHelper = createMockRedis()
