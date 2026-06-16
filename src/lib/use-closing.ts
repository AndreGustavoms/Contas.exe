import { useCallback, useEffect, useRef, useState } from "react";

// Anima a SAÍDA de overlays (modais, menus, dropdowns) sem precisar mexer no
// componente pai: ao fechar, marcamos `closing` (que dispara a animação de
// saída) e só chamamos o onClose real — que desmonta — depois de `ms`.
//
// Uso: const { closing, close } = useClosing(onClose); e então use `close` em
// todos os gatilhos de fechar, aplicando a classe de saída quando `closing`.
export function useClosing(onClose: () => void, ms = 200) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);

  const close = useCallback(() => {
    if (timer.current != null) return; // já está fechando
    setClosing(true);
    timer.current = window.setTimeout(onClose, ms);
  }, [onClose, ms]);

  useEffect(() => {
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);

  return { closing, close };
}
