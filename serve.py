"""Startet die Weinkeller-App auf diesem Rechner: python3 serve.py"""
import functools
import http.server
import os
import socket

PORT = 8765
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    # Always check for a newer file, so changes show up right away.
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def lan_ip():
    """IP address of this computer in the home network (no data is sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler) as httpd:
        print(f"Weinkeller läuft: http://localhost:{PORT}")
        ip = lan_ip()
        if ip:
            print(f"Am Handy im selben WLAN: http://{ip}:{PORT}")
        print("Beenden mit Ctrl+C")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
