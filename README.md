# Kassensturz – Kassenbon-Export für Lidl Plus

Firefox-Extension, die alle Lidl Plus Kassenbons aus deinem Lidl-Konto auf einmal exportiert.

- **PDF** pro Bon, sieht aus wie die Bonkopie auf lidl.de (Text auswählbar, mit Barcode)
- **JSON** pro Bon: Artikel, Menge, Einzelpreis, Rabatte, MwSt, Zahlungsart, Coupons
- **CSV** mit allen Artikeln aller Bons (`;`-getrennt, für Excel/LibreOffice)
- Zeitraum-Filter (TT.MM.JJJJ) mit Schnellauswahl
- Lädt mehrere Bons parallel und speichert jeden sofort in `Downloads/lidl-bons-<datum>/{pdf,json}/`

Inoffiziell, nicht mit Lidl verbunden. Es werden keine Daten gesammelt oder irgendwohin gesendet – alles passiert lokal im Browser mit deinem bestehenden Lidl-Login.

## Benutzung

1. Auf lidl.de einloggen.
2. Unten rechts auf das Kassensturz-Icon klicken.
3. Zeitraum wählen (leer = alle), **Start**.

## Entwicklung

Temporär laden: `about:debugging` → *Dieser Firefox* → *Temporäres Add-on laden* → `manifest.json`.

```bash
npx web-ext lint
npx web-ext build -a dist
```

`preview-ui.html` zeigt das Widget ohne Extension-Umgebung (Datei im Browser öffnen).

## Drittanbieter

- [jsPDF](https://github.com/parallax/jsPDF) 2.5.1 (MIT), unverändert von jsdelivr

## Lizenz

MIT
