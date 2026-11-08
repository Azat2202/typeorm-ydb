import type { BaseDataSourceOptions } from "../../data-source/BaseDataSourceOptions"

/**
 * Credentials used to authenticate in YDB.
 */
export type YdbCredentialsOptions =
    | {
          /**
           * No authentication (e.g. local-ydb).
           */
          readonly type: "anonymous"
      }
    | {
          /**
           * Login and password of a YDB user.
           */
          readonly type: "static"
          readonly username: string
          readonly password: string
      }
    | {
          /**
           * IAM or OAuth token.
           */
          readonly type: "access-token"
          readonly token: string
      }
    | {
          /**
           * Token from the cloud VM metadata service.
           */
          readonly type: "metadata"
          readonly endpoint?: string
          readonly flavor?: string
      }
    | {
          /**
           * Ready-made credentials provider from `@ydbjs/auth`.
           */
          readonly type: "provider"
          readonly provider: unknown
      }

/**
 * YDB specific connection options.
 *
 * The database is addressed either by `connectionString`
 * or by `host`, `port`, `database` and `ssl` — exactly one of the two.
 */
export interface YdbDataSourceOptions extends BaseDataSourceOptions {
    /**
     * Database type.
     */
    readonly type: "ydb"

    /**
     * Connection string, e.g. "grpc://localhost:2136/local" or "grpcs://ydb.example.com:2135/my/database".
     */
    readonly connectionString?: string

    /**
     * Database host.
     */
    readonly host?: string

    /**
     * Database gRPC port. Default is 2136.
     */
    readonly port?: number

    /**
     * Database path, e.g. "/local".
     */
    readonly database?: string

    /**
     * Use a secure connection (grpcs). Default is false.
     */
    readonly ssl?: boolean

    /**
     * Credentials used to authenticate. Default is anonymous.
     */
    readonly credentials?: YdbCredentialsOptions

    /**
     * Time in milliseconds to wait for the driver to become ready. Default is 10000.
     */
    readonly connectTimeout?: number

    /**
     * Session pool options of the query client.
     */
    readonly poolOptions?: {
        readonly maxSize?: number
        readonly minSize?: number
        readonly waitQueueFactor?: number
    }

    /**
     * Extra options passed to the `Driver` from `@ydbjs/core`
     * (TLS settings, gRPC channel options, `ydb.sdk.*` timeouts).
     */
    readonly driverOptions?: Record<string, any>
}
