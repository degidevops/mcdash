//+------------------------------------------------------------------+
//|                                                MCDashBridge.mq5  |
//|  Jembatan data MetaTrader 5 -> server mcdash (dashboard TPO).    |
//|                                                                  |
//|  Cara pakai                                                      |
//|   1. Salin file ini ke  <Data Folder>/MQL5/Experts/  lalu compile|
//|      (MetaEditor, F7).                                           |
//|   2. MT5: Tools > Options > Expert Advisors >                    |
//|      centang "Allow WebRequest for listed URL" dan tambahkan     |
//|      alamat server, mis.  127.0.0.1   (wajib juga untuk socket). |
//|   3. Di config.json server:  "source": {"type": "mt5"}           |
//|   4. Pasang EA ini di SATU chart simbol yang ingin dipantau      |
//|      (mis. XAUUSD). Timeframe chart bebas.                       |
//|                                                                  |
//|  Protokol: satu JSON per baris lewat TCP ("MCB1"), waktu bar     |
//|  dalam epoch UTC menurut offset server SAAT INI, plus field      |
//|  "off" (detik) agar server mengonversi ulang per bar (DST).      |
//+------------------------------------------------------------------+
#property copyright "mcdash"
#property version   "1.00"
#property strict

input string InpHost    = "127.0.0.1"; // alamat server mcdash
input int    InpPort    = 9899;        // = source.mt5_listen di config.json
input int    InpLiveMs  = 100;         // jeda minimum antar kiriman live (ms)
input int    InpChunk   = 2000;        // bar per baris saat mengirim riwayat

int      g_sock      = INVALID_HANDLE;
string   g_rx        = "";
int      g_tfs[];                      // timeframe (menit) yang diminta server
bool     g_dirty     = false;          // ada tick baru sejak kiriman live terakhir
uint     g_lastLive  = 0;
uint     g_lastHb    = 0;
datetime g_nextTry   = 0;
bool     g_ready     = false;          // hello sudah terkirim

//+------------------------------------------------------------------+
int OnInit()
  {
   EventSetMillisecondTimer(50);
   Comment("MCDashBridge: menghubungkan ke ", InpHost, ":", InpPort, " ...");
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   CloseSock();
   Comment("");
  }

void OnTick() { g_dirty = true; }

//+------------------------------------------------------------------+
void CloseSock()
  {
   if(g_sock != INVALID_HANDLE)
      SocketClose(g_sock);
   g_sock  = INVALID_HANDLE;
   g_ready = false;
   g_rx    = "";
   ArrayResize(g_tfs, 0);
  }

//--- offset waktu server broker terhadap UTC (detik), dibulatkan ke 15 menit agar tidak bergetar
long ServerOffset()
  {
   double d = (double)(TimeTradeServer() - TimeGMT());
   return (long)MathRound(d / 900.0) * 900;
  }

bool SendLine(const string s)
  {
   if(g_sock == INVALID_HANDLE)
      return false;
   uchar buf[];
   int n = StringToCharArray(s + "\n", buf, 0, WHOLE_ARRAY, CP_UTF8) - 1; // tanpa null terminator
   if(n <= 0)
      return false;
   return SocketSend(g_sock, buf, n) == n;
  }

ENUM_TIMEFRAMES TfFromMinutes(const int m)
  {
   switch(m)
     {
      case 1:    return PERIOD_M1;
      case 2:    return PERIOD_M2;
      case 3:    return PERIOD_M3;
      case 4:    return PERIOD_M4;
      case 5:    return PERIOD_M5;
      case 6:    return PERIOD_M6;
      case 10:   return PERIOD_M10;
      case 12:   return PERIOD_M12;
      case 15:   return PERIOD_M15;
      case 20:   return PERIOD_M20;
      case 30:   return PERIOD_M30;
      case 60:   return PERIOD_H1;
      case 120:  return PERIOD_H2;
      case 180:  return PERIOD_H3;
      case 240:  return PERIOD_H4;
      case 360:  return PERIOD_H6;
      case 480:  return PERIOD_H8;
      case 720:  return PERIOD_H12;
      case 1440: return PERIOD_D1;
     }
   return PERIOD_CURRENT;
  }

string BarJson(const MqlRates &r, const long off)
  {
   return "[" + IntegerToString((long)r.time - off) + "," +
          DoubleToString(r.open,  _Digits) + "," +
          DoubleToString(r.high,  _Digits) + "," +
          DoubleToString(r.low,   _Digits) + "," +
          DoubleToString(r.close, _Digits) + "," +
          IntegerToString((long)r.tick_volume) + "]";
  }

//--- kirim riwayat satu timeframe (terlama -> terbaru) dalam beberapa potongan
void SendHistory(const int tfMin, const int count)
  {
   ENUM_TIMEFRAMES tf = TfFromMinutes(tfMin);
   if(tf == PERIOD_CURRENT)
     {
      Print("MCDashBridge: timeframe M", tfMin, " tidak didukung");
      SendLine("{\"t\":\"bars\",\"tf\":" + IntegerToString(tfMin) + ",\"b\":[],\"last\":true}");
      return;
     }
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int got = -1;
   for(int attempt = 0; attempt < 5 && got <= 0; attempt++)
     {
      got = CopyRates(_Symbol, tf, 0, count, rates);
      if(got <= 0)
         Sleep(200); // data riwayat mungkin belum termuat
     }
   if(got <= 0)
     {
      SendLine("{\"t\":\"bars\",\"tf\":" + IntegerToString(tfMin) + ",\"b\":[],\"last\":true}");
      return;
     }
   long off = ServerOffset();
   for(int i = 0; i < got; i += InpChunk)
     {
      int    end = MathMin(i + InpChunk, got);
      string s   = "{\"t\":\"bars\",\"tf\":" + IntegerToString(tfMin) + ",\"off\":" + IntegerToString(off) + ",\"b\":[";
      for(int k = i; k < end; k++)
        {
         if(k > i)
            s += ",";
         s += BarJson(rates[k], off);
        }
      s += "],\"last\":" + (end >= got ? "true" : "false") + "}";
      if(!SendLine(s))
         return;
     }
   Print("MCDashBridge: riwayat M", tfMin, " terkirim (", got, " bar)");
  }

//--- kirim harga bid + bar berjalan (dan bar sebelumnya) untuk tiap timeframe yang diminta
void SendLive()
  {
   if(ArraySize(g_tfs) == 0)
      return;
   long   off = ServerOffset();
   string s   = "{\"t\":\"live\",\"off\":" + IntegerToString(off) + ",\"bid\":" + DoubleToString(SymbolInfoDouble(_Symbol, SYMBOL_BID), _Digits) + ",\"u\":[";
   bool   any = false;
   for(int i = 0; i < ArraySize(g_tfs); i++)
     {
      ENUM_TIMEFRAMES tf = TfFromMinutes(g_tfs[i]);
      MqlRates r[];
      ArraySetAsSeries(r, false);
      int n = CopyRates(_Symbol, tf, 0, 2, r); // r[n-1] = bar berjalan, r[n-2] = sebelumnya
      if(n < 1)
         continue;
      if(any)
         s += ",";
      s += "{\"tf\":" + IntegerToString(g_tfs[i]) + ",\"b\":" + BarJson(r[n - 1], off);
      if(n >= 2)
         s += ",\"p\":" + BarJson(r[n - 2], off);
      s += "}";
      any = true;
     }
   s += "]}";
   SendLine(s);
  }

//--- ekstraksi sederhana dari JSON satu baris buatan server (kunci tetap, nilai angka/teks sederhana)
string JStr(const string j, const string key)
  {
   int p = StringFind(j, "\"" + key + "\":\"");
   if(p < 0)
      return "";
   p += StringLen(key) + 4;
   int q = StringFind(j, "\"", p);
   return (q < 0) ? "" : StringSubstr(j, p, q - p);
  }

long JNum(const string j, const string key)
  {
   int p = StringFind(j, "\"" + key + "\":");
   if(p < 0)
      return 0;
   return StringToInteger(StringSubstr(j, p + StringLen(key) + 3, 20));
  }

bool HasTf(const int tf)
  {
   for(int i = 0; i < ArraySize(g_tfs); i++)
      if(g_tfs[i] == tf)
         return true;
   return false;
  }

void HandleLine(const string line)
  {
   string t = JStr(line, "t");
   if(t == "need")
     {
      int tf    = (int)JNum(line, "tf");
      int count = (int)JNum(line, "count");
      if(tf > 0 && count > 0)
        {
         if(!HasTf(tf))
           {
            ArrayResize(g_tfs, ArraySize(g_tfs) + 1);
            g_tfs[ArraySize(g_tfs) - 1] = tf;
           }
         SendHistory(tf, count);
        }
     }
   else
      if(t == "reject")
        {
         Print("MCDashBridge: ditolak server: ", JStr(line, "why"));
         Comment("MCDashBridge: ditolak server — ", JStr(line, "why"));
         CloseSock();
         g_nextTry = TimeLocal() + 30;
        }
  }

void Pump()
  {
   uint avail = SocketIsReadable(g_sock);
   while(avail > 0 && g_sock != INVALID_HANDLE)
     {
      uchar buf[];
      int n = SocketRead(g_sock, buf, avail, 50);
      if(n <= 0)
         break;
      g_rx += CharArrayToString(buf, 0, n, CP_UTF8);
      int p;
      while((p = StringFind(g_rx, "\n")) >= 0)
        {
         string line = StringSubstr(g_rx, 0, p);
         g_rx = StringSubstr(g_rx, p + 1);
         if(StringLen(line) > 0)
            HandleLine(line);
         if(g_sock == INVALID_HANDLE)
            return;
        }
      avail = SocketIsReadable(g_sock);
     }
  }

bool Connect()
  {
   g_sock = SocketCreate(SOCKET_DEFAULT);
   if(g_sock == INVALID_HANDLE)
      return false;
   if(!SocketConnect(g_sock, InpHost, InpPort, 1000))
     {
      SocketClose(g_sock);
      g_sock = INVALID_HANDLE;
      return false;
     }
   string hello = "{\"t\":\"hello\",\"v\":1,\"symbol\":\"" + _Symbol + "\",\"digits\":" + IntegerToString(_Digits) +
                  ",\"point\":" + DoubleToString(_Point, 10) +
                  ",\"off\":" + IntegerToString(ServerOffset()) + "}";
   if(!SendLine(hello))
     {
      CloseSock();
      return false;
     }
   g_ready = true;
   return true;
  }

//+------------------------------------------------------------------+
void OnTimer()
  {
   if(g_sock == INVALID_HANDLE || !SocketIsConnected(g_sock))
     {
      if(g_sock != INVALID_HANDLE)
         CloseSock();
      if(TimeLocal() >= g_nextTry)
        {
         if(Connect())
           {
            Comment("MCDashBridge: terhubung ke ", InpHost, ":", InpPort, " (", _Symbol, ")");
            Print("MCDashBridge: terhubung ke ", InpHost, ":", InpPort);
           }
         else
           {
            g_nextTry = TimeLocal() + 3;
            Comment("MCDashBridge: belum bisa terhubung ke ", InpHost, ":", InpPort,
                    " — pastikan server berjalan dan alamat ada di Tools > Options > Expert Advisors");
           }
        }
      return;
     }
   Pump();
   if(g_sock == INVALID_HANDLE)
      return;
   uint now = GetTickCount();
   if(g_dirty && now - g_lastLive >= (uint)InpLiveMs)
     {
      g_dirty    = false;
      g_lastLive = now;
      SendLive();
     }
   if(now - g_lastHb >= 5000)
     {
      g_lastHb = now;
      SendLine("{\"t\":\"hb\"}");
     }
  }
//+------------------------------------------------------------------+
