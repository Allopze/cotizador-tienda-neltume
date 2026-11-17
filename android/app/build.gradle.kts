plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.roborazzi)
}

// Servidor de la versión debug: el de desarrollo por omisión (con `adb reverse tcp:3000 tcp:3000`); las E2E pasan
// otro con -Pneltume.servidor=http://127.0.0.1:3101. El release siempre apunta a producción.
val servidorDebug = providers.gradleProperty("neltume.servidor").getOrElse("http://127.0.0.1:3000")

// Versión: la fija android/scripts/publicar.sh al compilar el release (-Pneltume.version.codigo/.nombre).
val versionCodigo = providers.gradleProperty("neltume.version.codigo").getOrElse("1").toInt()
val versionNombre = providers.gradleProperty("neltume.version.nombre").getOrElse("1.0.0")

// Llave de firma del release: fuera del repo (~/.neltume/). Sus datos van en ~/.gradle/gradle.properties:
//   neltume.firma.archivo=/Users/…/.neltume/cotizador.jks
//   neltume.firma.clave=…   neltume.firma.alias=neltume   neltume.firma.claveAlias=…
// Hay que respaldarla: sin ella no se puede publicar una actualización que se instale sobre la app actual.
// Sin archivo o sin contraseña, el release sale sin firmar y publicar.sh lo avisa; las compilaciones de prueba no se afectan.
val firmaClave = providers.gradleProperty("neltume.firma.clave").orNull?.takeIf { it.isNotBlank() }
val firmaArchivo = providers.gradleProperty("neltume.firma.archivo").orNull?.takeIf { firmaClave != null }

android {
    namespace = "cl.puertasneltume.cotizador"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "cl.puertasneltume.cotizador"
        minSdk {
            version = release(26)
        }
        targetSdk {
            version = release(37)
        }
        versionCode = versionCodigo
        versionName = versionNombre
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "SERVIDOR", "\"https://cotizador.puertasneltume.cl\"")
    }

    signingConfigs {
        if (firmaArchivo != null) create("release") {
            storeFile = file(firmaArchivo)
            storePassword = firmaClave
            keyAlias = providers.gradleProperty("neltume.firma.alias").getOrElse("neltume")
            keyPassword = providers.gradleProperty("neltume.firma.claveAlias").orNull?.takeIf { it.isNotBlank() } ?: firmaClave
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            buildConfigField("String", "SERVIDOR", "\"$servidorDebug\"")
        }
        release {
            if (firmaArchivo != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        // Como el release (R8 con ofuscación), pero firmado con la llave de depuración y contra el servidor local:
        // prueba las reglas de R8 sin tocar producción. ./gradlew :app:installPruebaR8 -Pneltume.servidor=…
        create("pruebaR8") {
            initWith(getByName("release"))
            applicationIdSuffix = ".r8"
            versionNameSuffix = "-r8"
            signingConfig = signingConfigs.getByName("debug")
            buildConfigField("String", "SERVIDOR", "\"$servidorDebug\"")
            matchingFallbacks += listOf("release")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }

    // Las capturas usan las respuestas reales del contrato (android/scripts/contrato.mjs).
    sourceSets.getByName("test").resources.srcDir("../nucleo/src/test/resources")

    lint {
        // Compartir las contraseñas guardadas entre el sitio y la app requiere Digital Asset Links (asset_statements
        // + /.well-known/assetlinks.json con la huella de la llave de firma): pendiente hasta crear la llave.
        disable += "CredManMissingDal"
    }

    packaging {
        resources {
            excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/versions/9/OSGI-INF/MANIFEST.MF")
        }
    }
}

dependencies {
    implementation(project(":nucleo"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.viewmodel.navigation3)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play)
    implementation(libs.androidx.profileinstaller)
    implementation(libs.kotlinx.coroutines.android)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.foundation)
    implementation(libs.compose.animation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material3.adaptive.navigation.suite)
    implementation(libs.adaptive)
    implementation(libs.adaptive.layout)

    implementation(libs.tink.android)
    implementation(libs.coil.compose)
    implementation(libs.coil.svg)
    implementation(libs.coil.network.okhttp)
    implementation(libs.reorderable)

    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    testImplementation(libs.junit)
    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.rule)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.espresso)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.androidx.test.uiautomator)
    androidTestImplementation(libs.kotlin.test)
}
