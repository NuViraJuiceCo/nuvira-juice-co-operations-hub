import { useState, useRef, useEffect } from "react";
import { RefreshCw } from "lucide-react";

export default function PullToRefresh({ children, onRefresh }) {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e) => {
      if (container.scrollTop === 0) {
        startY.current = e.touches[0].clientY;
      }
    };

    const handleTouchMove = (e) => {
      if (container.scrollTop !== 0) return;
      const currentY = e.touches[0].clientY;
      const distance = currentY - startY.current;

      if (distance > 0) {
        setPullDistance(distance);
        setPulling(distance > 60);
      }
    };

    const handleTouchEnd = async () => {
      if (pulling && !refreshing) {
        setRefreshing(true);
        setPulling(false);
        setPullDistance(0);
        await onRefresh();
        setRefreshing(false);
      } else {
        setPulling(false);
        setPullDistance(0);
      }
    };

    container.addEventListener("touchstart", handleTouchStart);
    container.addEventListener("touchmove", handleTouchMove);
    container.addEventListener("touchend", handleTouchEnd);

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [pulling, refreshing, onRefresh]);

  return (
    <div
      ref={containerRef}
      className="relative overflow-y-auto"
      style={{ maxHeight: "100vh" }}
    >
      {/* Pull indicator */}
      {(pulling || refreshing) && (
        <div className={`sticky top-0 flex justify-center py-3 bg-primary/5 transition-all ${refreshing ? "h-12" : ""}`}>
          <RefreshCw className={`h-4 w-4 text-primary ${refreshing ? "animate-spin" : ""}`} />
        </div>
      )}

      {/* Content */}
      <div style={{ transform: `translateY(${Math.min(pullDistance, 60)}px)` }}>
        {children}
      </div>
    </div>
  );
}