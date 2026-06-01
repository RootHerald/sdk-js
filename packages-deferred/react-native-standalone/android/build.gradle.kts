// Android Gradle build for the React Native bridge module.
//
// Consumed by the host app's autolinking via @react-native-community/cli.
// Versions track the Wave 3 Android SDK in src/clients/android/rootherald/.

plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "io.rootherald.rn"
    compileSdk = 34

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }

    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("com.facebook.react:react-android")
    implementation(project(":rootherald"))
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("org.jetbrains.kotlin:kotlin-stdlib")
}
