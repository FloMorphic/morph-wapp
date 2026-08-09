import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { readValue, writeValue } from '@/lib/localStore'

/**
 * Per-user run settings for launching a workflow — the engine tunables surfaced
 * in the Run dialog. They are NOT asked per run: the last-used values persist in
 * localStorage and prefill every launch, so a user sets them once and forgets.
 * Each maps to an inflow-fusion run setting; the values here are the engine
 * defaults, so a fresh install launches exactly as before.
 */

/** How long the whole run may take before the engine stops it. Default one hour. */
export const DEFAULT_EXECUTE_TIMEOUT_SEC = 60 * 60
/** Node-visit budget for one run — the guard against runaway loops. */
export const DEFAULT_PROCESS_NODE_LIMIT = 500
/** Fallback per-request timeout used for any http/nats call without its own. */
export const DEFAULT_REQUEST_TIMEOUT_SEC = 5
/** The engine stores the node limit as a uint16, so it cannot exceed this. */
export const MAX_PROCESS_NODE_LIMIT = 65535

export interface RunSettings {
  /** Process execute timeout, in seconds (`proc_timeout`). */
  executeTimeoutSec: number
  /** Max node visits before the run is stopped (`proc_node_limit`). */
  processNodeLimit: number
  /** Fallback request timeout, in seconds (`svc_req_timeout`). */
  requestTimeoutSec: number
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

  watch(executeTimeoutSec, (v) => writeValue('runExecuteTimeoutSec', v))
  watch(processNodeLimit, (v) => writeValue('runProcessNodeLimit', v))
  watch(requestTimeoutSec, (v) => writeValue('runRequestTimeoutSec', v))

  /** True when every setting matches its engine default. */
  function isDefault(): boolean {
    return (
      executeTimeoutSec.value === DEFAULT_EXECUTE_TIMEOUT_SEC &&
      processNodeLimit.value === DEFAULT_PROCESS_NODE_LIMIT &&
      requestTimeoutSec.value === DEFAULT_REQUEST_TIMEOUT_SEC
    )
  }

  /** Restore every setting to its engine default. */
  function reset(): void {
    executeTimeoutSec.value = DEFAULT_EXECUTE_TIMEOUT_SEC
    processNodeLimit.value = DEFAULT_PROCESS_NODE_LIMIT
    requestTimeoutSec.value = DEFAULT_REQUEST_TIMEOUT_SEC
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
    }
  }

  return {
    executeTimeoutSec,
    processNodeLimit,
    requestTimeoutSec,
    isDefault,
    reset,
    payload,
  }
})
