import { IncomingMessage } from 'node:http'
import { MongoClient } from 'mongodb'
import type {
  BetterAuthOptions,
  BetterAuthPlugin,
} from '@mx-space/compiled/auth'
import type { ServerResponse } from 'node:http'

import {
  APIError,
  betterAuth,
  createAuthMiddleware,
  mongodbAdapter,
  toNodeHandler,
} from '@mx-space/compiled/auth'

import { API_VERSION, CROSS_DOMAIN, MONGO_DB } from '~/app.config'
import { SECURITY } from '~/app.config.test'

import {
  AUTH_JS_ACCOUNT_COLLECTION,
  AUTH_JS_SESSION_COLLECTION,
  AUTH_JS_USER_COLLECTION,
} from './auth.constant'

const client = new MongoClient(MONGO_DB.customConnectionString || MONGO_DB.uri)

const db = client.db()

export async function CreateAuth(
  providers: BetterAuthOptions['socialProviders'],
) {
  const auth = betterAuth({
    database: mongodbAdapter(db),
    socialProviders: providers,
    basePath: isDev ? '/auth' : `/api/v${API_VERSION}/auth`,
    trustedOrigins: CROSS_DOMAIN.allowedOrigins.reduce(
      (acc: string[], origin: string) => {
        if (origin.startsWith('http')) {
          return [...acc, origin]
        }
        return [...acc, `https://${origin}`, `http://${origin}`]
      },
      [],
    ),
    advanced: {
      cookiePrefix: 'better-auth',
      ...(process.env.AUTH_COOKIE_DOMAIN && {
        defaultCookieAttributes: {
          domain: process.env.AUTH_COOKIE_DOMAIN,
          secure: !isDev,
          sameSite: 'lax' as const,
          httpOnly: true,
        },
      }),
    },
    account: {
      modelName: AUTH_JS_ACCOUNT_COLLECTION,
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'github'],
      },
    },
    session: {
      modelName: AUTH_JS_SESSION_COLLECTION,
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
    },
    appName: 'mx-core',
    secret: SECURITY.jwtSecret,
    plugins: [
      // @see https://gist.github.com/Bekacru/44cca7b3cf7dcdf1cee431a11d917b87
      {
        id: 'add-account-to-session',
        hooks: {
          after: [
            {
              matcher(context) {
                return context.path.startsWith('/callback')
              },
              handler: createAuthMiddleware(async (ctx) => {
                {
                  let provider = ctx.params.id

                  if (!provider) {
                    if (!ctx.request) {
                      return
                    }
                    const pathname = new URL(ctx.request.url).pathname
                    provider = ctx.params.id || pathname.split('/callback/')[1]
                    if (!provider) {
                      return
                    }
                  }

                  const responseHeader = (ctx.context.returned as any)
                    .headers as Headers

                  let finalSessionId = ''
                  const setSessionToken = responseHeader.get('set-cookie')

                  if (setSessionToken) {
                    const sessionId = setSessionToken
                      .split(';')[0]
                      .split('=')[1]
                      .split('.')[0]

                    if (sessionId) {
                      finalSessionId = sessionId
                    }
                  }

                  await db.collection(AUTH_JS_SESSION_COLLECTION).updateOne(
                    {
                      token: finalSessionId,
                    },
                    { $set: { provider } },
                  )
                }
              }),
            },
          ],
        },
        schema: {
          session: {
            fields: {
              provider: {
                type: 'string',
                required: false,
              },
            },
          },
        },
      } satisfies BetterAuthPlugin,
    ],
    user: {
      modelName: AUTH_JS_USER_COLLECTION,
      additionalFields: {
        isOwner: {
          type: 'boolean',
          defaultValue: false,
          input: false,
        },
        handle: {
          type: 'string',
          defaultValue: '',
        },
      },
    },
  })

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      console.log(`[Auth Handler] ${req.method} ${req.originalUrl}`)
      console.log(`[Auth Handler] Headers:`, {
        origin: req.headers.origin,
        cookie: req.headers.cookie ? 'present' : 'none',
        'content-type': req.headers['content-type']
      })

      // CORS 设置
      const origin = req.headers.origin
      const allowedOrigins = CROSS_DOMAIN.allowedOrigins.reduce(
        (acc: string[], allowedOrigin: string) => {
          if (allowedOrigin.startsWith('http')) {
            return [...acc, allowedOrigin]
          }
          return [...acc, `https://${allowedOrigin}`, `http://${allowedOrigin}`]
        },
        [],
      )
      
      if (origin && allowedOrigins.some(allowed => 
        allowed === origin || 
        (allowed.includes('*') && origin.includes(allowed.replace('*.', '')))
      )) {
        res.setHeader('Access-Control-Allow-Origin', origin)
      } else if (!origin) {
        res.setHeader('Access-Control-Allow-Origin', '*')
      }
      
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, x-session-uuid')
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Access-Control-Max-Age', '86400')
      res.setHeader('Vary', 'Origin')

      // 处理预检请求
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.end()
        return
      }

      const clonedRequest = new IncomingMessage(req.socket)
      const nodeHandler = toNodeHandler(auth)(
        Object.assign(clonedRequest, req, {
          url: req.originalUrl,
          socket: Object.assign(req.socket, {
            encrypted: isDev ? false : true,
          }),
        }),
        res,
      )

      return nodeHandler
    } catch (error) {
      console.error(`[Auth Handler Error] ${req.method} ${req.originalUrl}:`, error)
      console.error('Request headers:', req.headers)
      console.error('Error stack:', error.stack)
      
      res.statusCode = error.status || 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ 
        error: 'Authentication handler error',
        message: error.message || 'Unknown error',
        path: req.originalUrl,
        method: req.method,
        ...(isDev && { stack: error.stack })
      }))
    }
  }

  return {
    handler,
    auth: {
      options: auth.options,
      api: {
        getSession(params: Parameters<typeof auth.api.getSession>[0]) {
          return auth.api.getSession(params)
        },
        getProviders() {
          return Object.keys(auth.options.socialProviders || {})
        },
        async listUserAccounts(
          params: Parameters<typeof auth.api.listUserAccounts>[0],
        ) {
          try {
            const result = await auth.api.listUserAccounts(params)
            return result
          } catch (error) {
            if (error instanceof APIError) {
              return null
            }
            throw error
          }
        },
      },
    },
  }
}
