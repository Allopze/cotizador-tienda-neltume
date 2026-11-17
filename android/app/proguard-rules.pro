# kotlinx.serialization: conservar los serializadores generados de los modelos del núcleo.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class cl.puertasneltume.cotizador.** {
    *** Companion;
}
-keepclasseswithmembers class cl.puertasneltume.cotizador.** {
    kotlinx.serialization.KSerializer serializer(...);
}
# Tink trae anotaciones de errorprone que no existen en tiempo de ejecución.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
