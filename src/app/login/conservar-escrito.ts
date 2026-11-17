'use client';

import { useEffect, useRef } from 'react';

/**
 * Lo escrito antes de que la página termine de cargar (en un teléfono lento la puerta 3D demora la carga) queda en
 * el campo, pero no en el estado: React no lo recoge en un campo controlado y lo borra en cuanto vuelve a dibujar el
 * formulario. Al activarse, el formulario lo toma de cada campo (por su `id`); después, cada cambio llega por
 * `onChange`. Lo prueba tests/login.e2e.ts («lo escrito antes de que la página termine de cargar no se pierde»).
 */
export function useConservarEscrito(campos: Record<string, (valor: string) => void>) {
  const inicial = useRef(campos);
  useEffect(() => {
    for (const [id, asignar] of Object.entries(inicial.current)) {
      const campo = document.getElementById(id);
      if (campo instanceof HTMLInputElement && campo.value) asignar(campo.value);
    }
  }, []);
}
