"""Echte PDF-Datei fuer ein Training (reines Python, keine Bibliothek).

Hintergrund: In der installierten iPhone-App (Home-Bildschirm) oeffnet window.print() keinen Druckdialog.
Eine PDF-Datei laesst sich dort ueber das Teilen-Menue drucken oder in „Dateien“ sichern.
Nur Text (Helvetica, WinAnsi), Bilder werden weggelassen.
"""
import unicodedata

PAGE_W, PAGE_H = 595, 842          # A4 in Punkt
MARGIN = 50
CONTENT_W = PAGE_W - 2 * MARGIN

ACCENT = (0.78, 0.20, 0.42)
TEXT = (0.11, 0.11, 0.13)
MUTED = (0.42, 0.42, 0.46)
RULE = (0.86, 0.86, 0.88)

# Zeichenbreiten (1/1000 em) fuer ASCII 32..126 aus den Standard-AFM-Dateien
_W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
          556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500,
          667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
          556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500,
          722, 500, 500, 500, 334, 260, 334, 584]
_W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
           556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556,
           722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
           556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556,
           778, 556, 556, 500, 389, 280, 389, 584]
_SPECIAL = {'ß': 611, '„': 500, '“': 500, '”': 500, '‚': 278, '‘': 278, '’': 278, '–': 556, '—': 1000, '…': 1000,
            '·': 278, '€': 556, '•': 350}


def _char_w(ch, bold):
    table = _W_BOLD if bold else _W_REG
    o = ord(ch)
    if 32 <= o <= 126:
        return table[o - 32]
    if ch in _SPECIAL:
        return _SPECIAL[ch]
    base = unicodedata.normalize('NFD', ch)[0]   # ä -> a, É -> E
    if 32 <= ord(base) <= 126:
        return table[ord(base) - 32]
    return 556


def text_width(s, size, bold=False):
    return sum(_char_w(c, bold) for c in s) * size / 1000


def wrap(text, size, width, bold=False):
    """Zeilenumbruch nach Wortbreite; Absaetze bleiben erhalten, ueberlange Woerter werden geteilt."""
    lines = []
    for para in str(text or '').replace('\r\n', '\n').split('\n'):
        words, cur = para.split(), ''
        if not words:
            lines.append('')
            continue
        for w in words:
            while text_width(w, size, bold) > width:      # Wort laenger als die Zeile
                cut = len(w)
                while cut > 1 and text_width(w[:cut], size, bold) > width:
                    cut -= 1
                if cur:
                    lines.append(cur); cur = ''
                lines.append(w[:cut]); w = w[cut:]
            cand = (cur + ' ' + w) if cur else w
            if text_width(cand, size, bold) <= width:
                cur = cand
            else:
                lines.append(cur); cur = w
        lines.append(cur)
    return lines


def _pdf_str(s):
    raw = str(s).encode('cp1252', errors='replace')
    return b'(' + raw.replace(b'\\', b'\\\\').replace(b'(', b'\\(').replace(b')', b'\\)') + b')'


class _Doc:
    def __init__(self, footer):
        self.pages, self.ops, self.footer = [], [], footer
        self.y = PAGE_H - MARGIN

    def _color(self, rgb):
        return '%.3f %.3f %.3f rg' % rgb

    def text(self, x, s, size, bold=False, color=TEXT):
        font = 'F2' if bold else 'F1'
        self.ops.append(b'BT /' + font.encode() + b' %.1f Tf ' % size + self._color(color).encode() +
                        b' %.2f %.2f Td ' % (x, self.y) + _pdf_str(s) + b' Tj ET')

    def rule(self, color=RULE, width=0.6, y=None):
        y = self.y if y is None else y
        self.ops.append(('%.3f %.3f %.3f RG %.2f w %.2f %.2f m %.2f %.2f l S' %
                         (*color, width, MARGIN, y, PAGE_W - MARGIN, y)).encode())

    def ensure(self, needed):
        if self.y - needed < MARGIN + 24:
            self.new_page()

    def new_page(self):
        self._finish_page()
        self.y = PAGE_H - MARGIN

    def _finish_page(self):
        n = len(self.pages) + 1
        y_keep, self.y = self.y, MARGIN - 18
        label = '%s · Seite %d' % (self.footer, n)
        self.text(PAGE_W - MARGIN - text_width(label, 8.5), label, 8.5, color=MUTED)
        self.y = y_keep
        self.pages.append(b'\n'.join(self.ops))
        self.ops = []

    def paragraph(self, s, size, bold=False, color=TEXT, x=MARGIN, width=CONTENT_W, leading=1.38):
        for line in wrap(s, size, width, bold):
            self.ensure(size * leading)
            self.y -= size * leading
            if line:
                self.text(x, line, size, bold, color)

    def build(self, title):
        self._finish_page()
        objs = [None, None,                                                                 # 1 Katalog, 2 Seiten
                b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
                b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
                b'<< /Title ' + _pdf_str(title) + b' /Producer (TrainMaster) >>']
        kids = []
        for content in self.pages:
            objs.append(b'<< /Length %d >>\nstream\n' % len(content) + content + b'\nendstream')
            objs.append(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Contents %d 0 R '
                        b'/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>' % (PAGE_W, PAGE_H, len(objs)))
            kids.append(len(objs))
        objs[0] = b'<< /Type /Catalog /Pages 2 0 R >>'
        objs[1] = b'<< /Type /Pages /Kids [' + b' '.join(b'%d 0 R' % k for k in kids) + b'] /Count %d >>' % len(kids)
        out, offsets = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'), []
        for i, body in enumerate(objs, 1):
            offsets.append(len(out))
            out += b'%d 0 obj\n' % i + body + b'\nendobj\n'
        xref = len(out)
        out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)
        out += b''.join(b'%010d 00000 n \n' % o for o in offsets)
        out += b'trailer\n<< /Size %d /Root 1 0 R /Info 5 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, xref)
        return bytes(out)


def training_pdf(app_name, t, exercises, total, date_label, sport):
    doc = _Doc('Erstellt mit ' + app_name)
    doc.y -= 10
    doc.text(MARGIN, app_name.upper(), 9, True, ACCENT)
    doc.paragraph(t['title'], 24, True, leading=1.25)
    sub = date_label + (' · %s Uhr' % t['time'] if t['time'] else '') + ' · ' + sport
    doc.paragraph(sub, 11, color=MUTED)
    n = len(exercises)
    doc.paragraph('%d %s · %d Minuten' % (n, 'Übung' if n == 1 else 'Übungen', total), 11, True, color=TEXT)
    doc.y -= 12
    doc.rule(ACCENT, 1.2)

    if t['notes']:
        doc.y -= 8
        doc.paragraph('NOTIZEN', 9, True, color=MUTED)
        doc.paragraph(t['notes'], 10.5)
        doc.y -= 6

    if not exercises:
        doc.y -= 10
        doc.paragraph('Dieses Training enthält noch keine Übungen.', 11, color=MUTED)

    block = None
    for i, ex in enumerate(exercises, 1):
        if ex['block'] != block:
            block = ex['block']
            doc.ensure(70)
            doc.y -= 14
            doc.paragraph(block, 14, True, color=ACCENT)
            doc.y -= 4
            doc.rule()
        doc.ensure(60)
        doc.y -= 8
        dur = '%d Min.' % ex['duration'] if ex['duration'] is not None else ''
        title_w = CONTENT_W - 22 - (text_width(dur, 10.5, True) + 12 if dur else 0)
        lines = wrap(ex['title'], 12.5, title_w, True)
        doc.y -= 12.5 * 1.3
        doc.text(MARGIN, '%d' % i, 12.5, True, ACCENT)
        doc.text(MARGIN + 22, lines[0], 12.5, True)
        if dur:
            doc.text(PAGE_W - MARGIN - text_width(dur, 10.5, True), dur, 10.5, True, MUTED)
        for line in lines[1:]:
            doc.y -= 12.5 * 1.3
            doc.text(MARGIN + 22, line, 12.5, True)
        meta = ' · '.join(str(x) for x in (ex['sport'], '%s Feldspieler' % ex['field_players'],
                                            '%s Torhüter' % ex['goalkeepers'], ex['core_competency'],
                                            ex['difficulty'], ex['field_size']) if x not in (None, ''))
        doc.paragraph(meta, 9, color=MUTED, x=MARGIN + 22, width=CONTENT_W - 22)
        doc.y -= 3
        doc.paragraph(ex['description'], 10.5, x=MARGIN + 22, width=CONTENT_W - 22)
        doc.y -= 8
        doc.rule()
    return doc.build(t['title'])
