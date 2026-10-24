import React from 'react';

interface ScreenshotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotCaptureProps {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  isActive: boolean;
  onCapture: (dataUrl: string) => void;
  onCancel: () => void;
}

export function ScreenshotTool({ canvasRef, isActive, onCapture, onCancel }: ScreenshotCaptureProps) {
  const [mainRect, setMainRect] = React.useState<ScreenshotRect | null>(null);
  const [focusRects, setFocusRects] = React.useState<ScreenshotRect[]>([]);
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [drawingRect, setDrawingRect] = React.useState<ScreenshotRect | null>(null);
  const [startPoint, setStartPoint] = React.useState<{ x: number; y: number } | null>(null);

  const startCapture = () => {
    setMainRect(null);
    setFocusRects([]);
  };

  const cancelCapture = () => {
    setMainRect(null);
    setFocusRects([]);
    setIsDrawing(false);
    setDrawingRect(null);
    setStartPoint(null);
    onCancel();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (!mainRect) {
      setIsDrawing(true);
      setStartPoint({ x, y });
      setDrawingRect({ x, y, width: 0, height: 0 });
    } else {
      if (focusRects.length >= 3) return;
      setIsDrawing(true);
      setStartPoint({ x, y });
      setDrawingRect({ x, y, width: 0, height: 0 });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !startPoint || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setDrawingRect({
      x: Math.min(startPoint.x, x),
      y: Math.min(startPoint.y, y),
      width: Math.abs(x - startPoint.x),
      height: Math.abs(y - startPoint.y),
    });
  };

  const handleMouseUp = () => {
    if (!drawingRect || drawingRect.width < 5 || drawingRect.height < 5) {
      setIsDrawing(false);
      setDrawingRect(null);
      setStartPoint(null);
      return;
    }

    if (!mainRect) {
      setMainRect(drawingRect);
    } else {
      if (focusRects.length < 3) {
        if (
          drawingRect.x >= mainRect.x &&
          drawingRect.y >= mainRect.y &&
          drawingRect.x + drawingRect.width <= mainRect.x + mainRect.width &&
          drawingRect.y + drawingRect.height <= mainRect.y + mainRect.height
        ) {
          setFocusRects([...focusRects, drawingRect]);
        }
      }
    }

    setIsDrawing(false);
    setDrawingRect(null);
    setStartPoint(null);
  };

  const handleKeyDown = React.useCallback(
    (e: KeyboardEvent) => {
      if (!isActive) return;
      if (e.key === 'Escape') {
        cancelCapture();
      } else if (e.key === 'Enter' && mainRect) {
        captureSnapshot();
      }
    },
    [isActive, mainRect]
  );

  React.useEffect(() => {
    if (isActive) {
      startCapture();
      window.addEventListener('keydown', handleKeyDown);
    } else {
      cancelCapture();
      window.removeEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, handleKeyDown]);

  const captureSnapshot = () => {
    if (!mainRect || !canvasRef.current) return;

    const canvas = canvasRef.current.querySelector('canvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const srcX = mainRect.x * dpr;
    const srcY = mainRect.y * dpr;
    const srcW = mainRect.width * dpr;
    const srcH = mainRect.height * dpr;

    const tempCanvas = document.createElement('canvas');
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
    tempCanvas.width = srcW * scale;
    tempCanvas.height = srcH * scale;

    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(
      canvas,
      srcX,
      srcY,
      srcW,
      srcH,
      0,
      0,
      tempCanvas.width,
      tempCanvas.height
    );

    if (focusRects.length > 0) {
      ctx.strokeStyle = '#ff4040';
      ctx.lineWidth = 3;
      ctx.font = 'bold 24px sans-serif';
      ctx.fillStyle = '#ff4040';

      focusRects.forEach((fr, i) => {
        const relX = (fr.x - mainRect.x) * dpr * scale;
        const relY = (fr.y - mainRect.y) * dpr * scale;
        const relW = fr.width * dpr * scale;
        const relH = fr.height * dpr * scale;

        ctx.strokeRect(relX, relY, relW, relH);
        ctx.fillText(`${i + 1}`, relX + 8, relY + 28);
      });
    }

    const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.9);
    onCapture(dataUrl);
    cancelCapture();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    cancelCapture();
  };

  if (!isActive) return null;

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
      className="pointer-events-auto absolute inset-0 z-50 cursor-crosshair"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
    >
      {mainRect && (
        <div
          className="absolute border-2 border-[#f5a623]"
          style={{
            left: mainRect.x,
            top: mainRect.y,
            width: mainRect.width,
            height: mainRect.height,
          }}
        />
      )}

      {focusRects.map((fr, i) => (
        <div
          key={i}
          className="absolute border-2 border-[#ff4040]"
          style={{
            left: fr.x,
            top: fr.y,
            width: fr.width,
            height: fr.height,
          }}
        >
          <span className="absolute left-2 top-1 text-lg font-bold text-[#ff4040]">
            {i + 1}
          </span>
        </div>
      ))}

      {isDrawing && drawingRect && (
        <div
          className={`absolute border-2 ${
            mainRect ? 'border-[#ff4040]' : 'border-[#f5a623]'
          }`}
          style={{
            left: drawingRect.x,
            top: drawingRect.y,
            width: drawingRect.width,
            height: drawingRect.height,
          }}
        />
      )}

      {mainRect && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-lg border border-emerald-500/50 bg-black/80 px-4 py-2 text-[12px] font-bold text-emerald-300 backdrop-blur-md">
          {focusRects.length < 3
            ? `Рамок: ${focusRects.length}/3 · ЛКМ-драг — добавить рамку · Enter — снимок · Esc — отмена`
            : 'Enter — сделать снимок · Esc — отмена'}
        </div>
      )}

      {!mainRect && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-lg border border-amber-500/50 bg-black/80 px-4 py-2 text-[12px] font-bold text-amber-300 backdrop-blur-md">
          ЛКМ-драг — выделить область снимка · ПКМ / Esc — отмена
        </div>
      )}
    </div>
  );
}
