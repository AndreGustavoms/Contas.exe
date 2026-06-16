import { useMemo } from "react";
import qrcode from "qrcode-generator";

type QrCodeProps = {
  /** O conteúdo codificado (ex.: a URI otpauth://). */
  value: string;
  /** Lado do QR em pixels. */
  size?: number;
  className?: string;
};

// Renderiza um QR Code como SVG: fundo branco + módulos pretos, fixos, para
// escanear de forma confiável em qualquer tema (a câmera precisa de contraste).
// A geração (Reed-Solomon, máscaras) fica a cargo do qrcode-generator; aqui só
// montamos o caminho a partir da matriz de módulos.
export function QrCode({ value, size = 168, className }: QrCodeProps) {
  const { path, dim } = useMemo(() => {
    const qr = qrcode(0, "M"); // 0 = versão automática; ECC nível M
    qr.addData(value);
    qr.make();

    const count = qr.getModuleCount();
    const margin = 4; // zona de silêncio mínima exigida pela spec
    const dim = count + margin * 2;

    let path = "";
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) {
          path += `M${col + margin} ${row + margin}h1v1h-1z`;
        }
      }
    }

    return { path, dim };
  }, [value]);

  return (
    <svg
      aria-hidden="true"
      className={className}
      height={size}
      shapeRendering="crispEdges"
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
    >
      <rect height={dim} width={dim} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
