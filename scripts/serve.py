#!/usr/bin/env python3
# no-cache, multi-threaded static server (browser profile was caching stale modules
# from a prior build). ThreadingHTTPServer so parallel module fetches don't deadlock.
# POST /llm: dumb planner proxy — forwards {system, contents, temperature} to Gemini
# (key stays server-side; the prompt lives in src/brain.js so it iterates without a
# server restart). Returns {text} or {error} with the upstream detail.
import http.server, json, os, socketserver, sys, urllib.request, urllib.error

GEMINI_KEY = os.environ.get('GEMINI_API_KEY', '')
# gemini-3.5-flash (reasoning model) leaked "thinking out loud" text after valid JSON
# even with thinkingBudget:0 (verified 2026-07-16, nondeterministic ~1/3 of replies).
# 2.5-flash is a non-reasoning model — clean JSON in 5/5 manual trials.
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')
GEMINI_TTS_MODEL = os.environ.get('GEMINI_TTS_MODEL', 'gemini-3.1-flash-tts-preview')

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, fmt, *a):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % a))

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _gemini(self, model, payload):
        url = (f'https://generativelanguage.googleapis.com/v1beta/models/'
               f'{model}:generateContent?key={GEMINI_KEY}')
        r = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                   headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(r, timeout=25) as resp:
            return json.load(resp)

    def do_POST(self):
        if self.path not in ('/llm', '/tts'):
            return self._json(404, {'error': 'unknown endpoint (POST /llm or /tts)'})
        if not GEMINI_KEY:
            return self._json(503, {'error': 'GEMINI_API_KEY not set in the server environment — restart serve.py from a shell with the key (source ~/.zshrc)'})
        try:
            req = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            if self.path == '/tts':
                out = self._gemini(GEMINI_TTS_MODEL, {
                    'contents': [{'parts': [{'text': req['text']}]}],
                    'generationConfig': {
                        'responseModalities': ['AUDIO'],
                        'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {
                            'voiceName': req.get('voice', 'Charon')}}},
                    },
                })
                d = out['candidates'][0]['content']['parts'][0]['inlineData']
                return self._json(200, {'audio': d['data'], 'mime': d['mimeType']})
            payload = {
                'systemInstruction': {'parts': [{'text': req['system']}]},
                'contents': req['contents'],
                'generationConfig': {
                    'responseMimeType': 'application/json',
                    'temperature': req.get('temperature', 0.4),
                    'thinkingConfig': {'thinkingBudget': 0},
                },
            }
            out = self._gemini(GEMINI_MODEL, payload)
            text = out['candidates'][0]['content']['parts'][0]['text']
            self._json(200, {'text': text})
        except urllib.error.HTTPError as e:
            self._json(502, {'error': f'Gemini {e.code}: {e.read().decode()[:400]}'})
        except Exception as e:
            self._json(500, {'error': f'{type(e).__name__}: {e}'})

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8741
with http.server.ThreadingHTTPServer(('127.0.0.1', port), H) as s:
    print(f'serving no-cache threaded on :{port}', flush=True)
    s.serve_forever()
