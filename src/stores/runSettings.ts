import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { readValue, writeValue } from '@/lib/localStore'

/**
 * Per-user run settings for launching a workflow — the engine tunables surfaced
 * in the Run dialog. They are NOT asked per run: the last-used values persist in
 * localStorage and prefill every launch, so a user sets them once and forgets.
 * Each maps to an inflow-fusion run setting; the values here are what a fresh
 * install sends, overriding the engine default where they differ.
 */

/** How long the whole run may take before the engine stops it. Default three hours. */
export const DEFAULT_EXECUTE_TIMEOUT_SEC = 3 * 60 * 60
/** Node-visit budget for one run — the guard against runaway loops. */
export const DEFAULT_PROCESS_NODE_LIMIT = 500
/** Fallback per-request timeout used for any http/nats call without its own. */
export const DEFAULT_REQUEST_TIMEOUT_SEC = 5
/** Whether a run halts at the first node error. The engine carries on by default. */
export const DEFAULT_STOP_ON_ERROR = false
/** The engine stores the node limit as a uint16, so it cannot exceed this. */
export const MAX_PROCESS_NODE_LIMIT = 65535

export interface RunSettings {
  /** Process execute timeout, in seconds (`proc_timeout`). */
  executeTimeoutSec: number
  /** Max node visits before the run is stopped (`proc_node_limit`). */
  processNodeLimit: number
  /** Fallback request timeout, in seconds (`svc_req_timeout`). */
  requestTimeoutSec: number
  /** Halt the run at the first node error instead of carrying on (`stop_on_error`). */
  stopOnError: boolean
}

/** Coerce a persisted value to a boolean, tolerating anything else in storage. */
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Coerce a persisted/entered value to a positive integer, or the fallback. */
function posInt(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const useRunSettingsStore = defineStore('runSettings', () => {
  const executeTimeoutSec = ref<number>(
    posInt(readValue('runExecuteTimeoutSec', DEFAULT_EXECUTE_TIMEOUT_SEC), DEFAULT_EXECUTE_TIMEOUT_SEC),
  )
  const processNodeLimit = ref<number>(
    posInt(readValue('runProcessNodeLimit', DEFAULT_PROCESS_NODE_LIMIT), DEFAULT_PROCESS_NODE_LIMIT),
  )
  const requestTimeoutSec = ref<number>(
    posInt(readValue('runRequestTimeoutSec', DEFAULT_REQUEST_TIMEOUT_SEC), DEFAULT_REQUEST_TIMEOUT_SEC),
  )

  const stopOnError = ref<boolean>(bool(readValue('runStopOnError', DEFAULT_STOP_ON_ERROR), DEFAULT_STOP_ON_ERROR))

  watch(executeTimeoutSec, (v) => writeValue('runExecuteTimeoutSec', v))
  watch(processNodeLimit, (v) => writeValue('runProcessNodeLimit', v))
  watch(requestTimeoutSec, (v) => writeValue('runRequestTimeoutSec', v))
  watch(stopOnError, (v) => writeValue('runStopOnError', v))

  /** True when every setting matches its engine default. */
  function isDefault(): boolean {
    return (
      executeTimeoutSec.value === DEFAULT_EXECUTE_TIMEOUT_SEC &&
      processNodeLimit.value === DEFAULT_PROCESS_NODE_LIMIT &&
      requestTimeoutSec.value === DEFAULT_REQUEST_TIMEOUT_SEC &&
      stopOnError.value === DEFAULT_STOP_ON_ERROR
    )
  }

  /** Restore every setting to its engine default. */
  function reset(): void {
    executeTimeoutSec.value = DEFAULT_EXECUTE_TIMEOUT_SEC
    processNodeLimit.value = DEFAULT_PROCESS_NODE_LIMIT
    requestTimeoutSec.value = DEFAULT_REQUEST_TIMEOUT_SEC
    stopOnError.value = DEFAULT_STOP_ON_ERROR
  }

  /** The settings payload sent with a launch, clamped to safe positive integers. */
  function payload(): RunSettings {
    return {
      executeTimeoutSec: posInt(executeTimeoutSec.value, DEFAULT_EXECUTE_TIMEOUT_SEC),
      processNodeLimit: Math.min(
        posInt(processNodeLimit.value, DEFAULT_PROCESS_NODE_LIMIT),
        MAX_PROCESS_NODE_LIMIT,
      ),
      requestTimeoutSec: posInt(requestTimeoutSec.value, DEFAULT_REQUEST_TIMEOUT_SEC),
      stopOnError: bool(stopOnError.value, DEFAULT_STOP_ON_ERROR),
    }
  }

  return {
    executeTimeoutSec,
    processNodeLimit,
    requestTimeoutSec,
    stopOnError,
    isDefault,
    reset,
    payload,
  }
})
