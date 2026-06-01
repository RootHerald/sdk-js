package io.rootherald.rn

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import io.rootherald.RootHeraldClient
import io.rootherald.Verdict
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Bridges the Kotlin [RootHeraldClient] (Wave 3 Android SDK) into the React
 * Native JS layer. Handles are opaque UUID strings; the JS side keeps one
 * handle per logical client and disposes via [destroy].
 *
 * Coroutines launched per request run on a [SupervisorJob] tied to the
 * module's lifetime, so a verify() that fails does not cancel sibling
 * requests. The job is cancelled in [invalidate].
 */
class RootHeraldRNModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val clients = ConcurrentHashMap<String, RootHeraldClient>()

    private val supervisor: Job = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + supervisor)

    override fun getName(): String = NAME

    @ReactMethod
    fun create(apiKey: String, endpoint: String, promise: Promise) {
        try {
            val handle = UUID.randomUUID().toString()
            clients[handle] = RootHeraldClient(apiKey = apiKey, endpoint = endpoint)
            promise.resolve(handle)
        } catch (e: Exception) {
            promise.reject("E_CREATE_FAILED", e.message ?: "create failed", e)
        }
    }

    @ReactMethod
    fun setApplicationId(handle: String, applicationId: String, promise: Promise) {
        val client = clients[handle]
        if (client == null) {
            promise.reject("E_INVALID_HANDLE", "Unknown client handle: $handle")
            return
        }
        client.setApplicationId(applicationId)
        promise.resolve(null)
    }

    @ReactMethod
    fun setMockTpm(handle: String, enabled: Boolean, promise: Promise) {
        val client = clients[handle]
        if (client == null) {
            promise.reject("E_INVALID_HANDLE", "Unknown client handle: $handle")
            return
        }
        client.setMockTpm(enabled)
        promise.resolve(null)
    }

    @ReactMethod
    fun verify(handle: String, action: String, promise: Promise) {
        val client = clients[handle]
        if (client == null) {
            promise.reject("E_INVALID_HANDLE", "Unknown client handle: $handle")
            return
        }
        scope.launch {
            try {
                val r = client.verify(action)
                val map = Arguments.createMap().apply {
                    putString("verdict", verdictToString(r.verdict))
                    putString("deviceId", r.deviceId)
                    putString("tpmClass", r.tpmClass)
                    putString("posture", r.postureJson)
                    putString("reason", r.reason)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("E_VERIFY_FAILED", e.message ?: "verify failed", e)
            }
        }
    }

    @ReactMethod
    fun destroy(handle: String, promise: Promise) {
        clients.remove(handle)
        promise.resolve(null)
    }

    override fun invalidate() {
        supervisor.cancel()
        clients.clear()
        super.invalidate()
    }

    private fun verdictToString(v: Verdict): String = when (v) {
        Verdict.Allow -> "allow"
        Verdict.Warn -> "warn"
        Verdict.Deny -> "deny"
    }

    companion object {
        const val NAME = "RootHeraldRN"
    }
}
