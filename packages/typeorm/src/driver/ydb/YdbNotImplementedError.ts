import { TypeORMError } from "../../error/TypeORMError"

/**
 * Thrown when a feature of the YDB driver is not implemented yet.
 */
export class YdbNotImplementedError extends TypeORMError {
    constructor(method: string) {
        super(`YDB driver: ${method} is not implemented yet`)
    }
}
