import type { ActiveOperation, OperationExecutionRuntime } from "./viewer-operation-runtime.js";
import type { MutationOutcome, MutationSpec } from "./viewer-operation-types.js";
export declare function executeMutation<T, R>(runtime: OperationExecutionRuntime, active: ActiveOperation, spec: MutationSpec<T, R>): Promise<MutationOutcome<T>>;
