// Polymarket WebSocket: real time price updates
// wss://ws-subscriptions-clob.polymarket.com/ws/market

const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

export interface PriceUpdate {
  tokenId: string;
  price: string;
  timestamp: number;
}

type PriceCallback = (update: PriceUpdate) => void;

/**
 * Subscribe to real time price updates for specific tokens.
 * Returns a cleanup function to unsubscribe.
 */
export function subscribeToPrices(
  tokenIds: string[],
  onUpdate: PriceCallback
): () => void {
  // WebSocket only works in browser
  if (typeof window === "undefined") return () => {};

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      ws?.send(JSON.stringify({
        assets_ids: tokenIds,
        type: "market",
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.price !== undefined && data.asset_id) {
          onUpdate({
            tokenId: data.asset_id,
            price: String(data.price),
            timestamp: Date.now(),
          });
        }
      } catch {}
    };

    ws.onclose = () => {
      // Auto reconnect after 5s
      reconnectTimer = setTimeout(connect, 5000);
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  connect();

  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
    ws = null;
  };
}
