import type { ActiveOperation, OperationExecutionRuntime } from "./viewer-operation-runtime.js";
import type { LoadOutcome, LoadSpec } from "./viewer-operation-types.js";
export declare function executeLoad<T>(runtime: OperationExecutionRuntime, active: ActiveOperation, spec: LoadSpec<T>): Promise<LoadOutcome<T>>;
