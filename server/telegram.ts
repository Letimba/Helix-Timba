export interface TelegramConfig {
  bot_token: string;
  chat_id: string;
  enabled: boolean;
  notify_buy: boolean;
  notify_exit: boolean;
  notify_rug: boolean;
  notify_tp_sl: boolean;
}

export class TelegramNotifier {
  config: TelegramConfig;

  constructor(cfg?: Partial<TelegramConfig>) {
    this.config = {
      bot_token: cfg?.bot_token || '',
      chat_id: cfg?.chat_id || '',
      enabled: Boolean(cfg?.enabled),
      notify_buy: cfg?.notify_buy ?? true,
      notify_exit: cfg?.notify_exit ?? true,
      notify_rug: cfg?.notify_rug ?? true,
      notify_tp_sl: cfg?.notify_tp_sl ?? true
    };
  }

  updateConfig(cfg: Partial<TelegramConfig>) {
    this.config = { ...this.config, ...cfg };
  }

  async send(text: string): Promise<{ ok: boolean; message?: string; error?: string }> {
    const token = this.config.bot_token?.trim();
    const chat = this.config.chat_id?.trim();

    if (!token || !chat) {
      return { ok: false, error: 'Telegram Bot Token oder Chat ID fehlt' };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }),
        signal: controller.signal
      });
      clearTimeout(timer);

      const json = await res.json() as any;
      if (json.ok) {
        return { ok: true, message: 'Telegram Nachricht erfolgreich gesendet' };
      } else {
        return { ok: false, error: json.description || 'Telegram API Fehler' };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Netzwerkfehler zu Telegram' };
    }
  }

  async testConnection(): Promise<{ ok: boolean; bot_name?: string; error?: string }> {
    const token = this.config.bot_token?.trim();
    if (!token) return { ok: false, error: 'Kein Bot Token angegeben' };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: controller.signal });
      clearTimeout(timer);
      const json = await res.json() as any;
      if (json.ok && json.result?.username) {
        return { ok: true, bot_name: `@${json.result.username}` };
      }
      return { ok: false, error: json.description || 'Bot Token ungültig' };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Fehler beim Verbinden mit Telegram' };
    }
  }
}
