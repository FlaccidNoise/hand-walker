#!/usr/bin/env python3
# no-cache, multi-threaded static server (browser profile was caching stale modules
# from a prior build). ThreadingHTTPServer so parallel module fetches don't deadlock.
import http.server, socketserver, sys

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, fmt, *a):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % a))

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8741
with http.server.ThreadingHTTPServer(('0.0.0.0', port), H) as s:
    print(f'serving no-cache threaded on :{port}', flush=True)
    s.serve_forever()
