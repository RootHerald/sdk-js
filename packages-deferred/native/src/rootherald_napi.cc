// N-API binding for the Root Herald native SDK.
//
// Build with: node-gyp rebuild
// (RootHerald.dll must be on the runtime load path; see README.md)
//
// Wave 2 N3: this is the minimum bridge — Create / Verify / Destroy.
// Everything else (SetEndpoint, SetApplicationId, mock-TPM toggle) can be
// added by following the pattern in Verify. Keeping the surface small
// keeps the maintenance cost down until adoption shows what callers
// actually want from JS.

#include <napi.h>
#include "rootherald.h"
#include <string>

namespace {

class RootHeraldNative : public Napi::ObjectWrap<RootHeraldNative> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    RootHeraldNative(const Napi::CallbackInfo& info);
    ~RootHeraldNative();

    Napi::Value Verify(const Napi::CallbackInfo& info);
    Napi::Value SetEndpoint(const Napi::CallbackInfo& info);
    Napi::Value SetApplicationId(const Napi::CallbackInfo& info);
    Napi::Value Destroy(const Napi::CallbackInfo& info);

private:
    RootHeraldClient* client_ = nullptr;
};

Napi::Object RootHeraldNative::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "RootHeraldNative", {
        InstanceMethod("verify", &RootHeraldNative::Verify),
        InstanceMethod("setEndpoint", &RootHeraldNative::SetEndpoint),
        InstanceMethod("setApplicationId", &RootHeraldNative::SetApplicationId),
        InstanceMethod("destroy", &RootHeraldNative::Destroy),
    });

    Napi::FunctionReference* constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData<Napi::FunctionReference>(constructor);

    exports.Set("RootHeraldNative", func);
    exports.Set("abiVersion", Napi::String::New(env, RootHerald_AbiVersionString()));
    exports.Set("libraryVersion", Napi::String::New(env, RootHerald_LibraryVersionString()));
    return exports;
}

RootHeraldNative::RootHeraldNative(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<RootHeraldNative>(info)
{
    auto env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "api_key (string) is required").ThrowAsJavaScriptException();
        return;
    }
    std::string apiKey = info[0].As<Napi::String>().Utf8Value();
    std::string endpoint;
    if (info.Length() >= 2 && info[1].IsString()) {
        endpoint = info[1].As<Napi::String>().Utf8Value();
    }
    client_ = RootHeraldClient_Create(apiKey.c_str(), endpoint.empty() ? nullptr : endpoint.c_str());
    if (!client_) {
        Napi::Error::New(env, "RootHeraldClient_Create returned NULL").ThrowAsJavaScriptException();
    }
}

RootHeraldNative::~RootHeraldNative()
{
    if (client_) {
        RootHeraldClient_Destroy(client_);
        client_ = nullptr;
    }
}

Napi::Value RootHeraldNative::Verify(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    if (!client_) {
        Napi::Error::New(env, "client destroyed").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string action = "default";
    if (info.Length() >= 1 && info[0].IsString()) {
        action = info[0].As<Napi::String>().Utf8Value();
    }

    RootHeraldVerifyResult result = {};
    auto status = RootHeraldClient_Verify(client_, action.c_str(), &result);

    auto obj = Napi::Object::New(env);
    obj.Set("status", Napi::Number::New(env, status));
    obj.Set("verdict", Napi::Number::New(env, result.verdict));
    obj.Set("deviceId", Napi::String::New(env, result.device_id));
    obj.Set("tpmClass", Napi::String::New(env, result.tpm_class));
    obj.Set("postureJson", Napi::String::New(env, result.posture_json));
    obj.Set("reason", Napi::String::New(env, result.reason));
    return obj;
}

Napi::Value RootHeraldNative::SetEndpoint(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "endpoint (string) required").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    std::string ep = info[0].As<Napi::String>().Utf8Value();
    auto status = RootHeraldClient_SetEndpoint(client_, ep.c_str());
    return Napi::Number::New(env, status);
}

Napi::Value RootHeraldNative::SetApplicationId(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "app_id (string) required").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    std::string id = info[0].As<Napi::String>().Utf8Value();
    auto status = RootHeraldClient_SetApplicationId(client_, id.c_str());
    return Napi::Number::New(env, status);
}

Napi::Value RootHeraldNative::Destroy(const Napi::CallbackInfo& info)
{
    if (client_) {
        RootHeraldClient_Destroy(client_);
        client_ = nullptr;
    }
    return info.Env().Undefined();
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports)
{
    return RootHeraldNative::Init(env, exports);
}

} // namespace

NODE_API_MODULE(rootherald_napi, InitAll)
