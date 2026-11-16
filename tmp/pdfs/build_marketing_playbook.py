from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
    Table, TableStyle, Image, KeepTogether, HRFlowable, Flowable,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output" / "pdf" / "Kageflow-Marketing-Playbook.pdf"
DASHBOARD = ROOT / "tmp" / "pdfs" / "reference-dashboard.png"
OUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = colors.HexColor("#151A34")
NAVY2 = colors.HexColor("#20284E")
TEAL = colors.HexColor("#13A58E")
TEAL_DARK = colors.HexColor("#08786C")
GOLD = colors.HexColor("#D9A447")
INK = colors.HexColor("#24283B")
MUTED = colors.HexColor("#657087")
LINE = colors.HexColor("#D9DEEA")
PAPER = colors.HexColor("#F5F7FA")
PALE_TEAL = colors.HexColor("#E9F6F3")
PALE_GOLD = colors.HexColor("#FBF5E8")
WHITE = colors.white


def register_fonts():
    base = Path("C:/Windows/Fonts")
    candidates = [
        ("KageSans", base / "segoeui.ttf"),
        ("KageSans-Bold", base / "segoeuib.ttf"),
        ("KageSans-Italic", base / "segoeuii.ttf"),
    ]
    for name, path in candidates:
        if path.exists():
            pdfmetrics.registerFont(TTFont(name, str(path)))
    if "KageSans" not in pdfmetrics.getRegisteredFontNames():
        return "Helvetica", "Helvetica-Bold"
    regular = "KageSans"
    bold = "KageSans-Bold" if "KageSans-Bold" in pdfmetrics.getRegisteredFontNames() else "KageSans"
    return regular, bold


REG, BOLD = register_fonts()


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="Kicker", fontName=BOLD, fontSize=8, leading=11, textColor=TEAL_DARK,
    spaceAfter=5, tracking=1.2,
))
styles.add(ParagraphStyle(
    name="TitleK", fontName=BOLD, fontSize=25, leading=29, textColor=NAVY,
    spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="Deck", fontName=REG, fontSize=11, leading=16, textColor=MUTED,
    spaceAfter=12,
))
styles.add(ParagraphStyle(
    name="H2K", fontName=BOLD, fontSize=14, leading=18, textColor=NAVY,
    spaceBefore=7, spaceAfter=6, keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="H3K", fontName=BOLD, fontSize=10, leading=13, textColor=INK,
    spaceBefore=1, spaceAfter=3, keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="BodyK", fontName=REG, fontSize=9.25, leading=13.5, textColor=INK,
    spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="SmallK", fontName=REG, fontSize=8, leading=11, textColor=MUTED,
    spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="TinyK", fontName=REG, fontSize=7, leading=9, textColor=MUTED,
))
styles.add(ParagraphStyle(
    name="CardHead", fontName=BOLD, fontSize=10, leading=13, textColor=NAVY,
    spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="CardBody", fontName=REG, fontSize=8.3, leading=11.5, textColor=INK,
))
styles.add(ParagraphStyle(
    name="TableHead", fontName=BOLD, fontSize=8, leading=10, textColor=WHITE,
))
styles.add(ParagraphStyle(
    name="TableBody", fontName=REG, fontSize=7.8, leading=10.3, textColor=INK,
))
styles.add(ParagraphStyle(
    name="StepNum", fontName=BOLD, fontSize=11, leading=14, textColor=TEAL_DARK,
    alignment=TA_CENTER,
))
styles.add(ParagraphStyle(
    name="Callout", fontName=REG, fontSize=8.7, leading=12.5, textColor=NAVY,
))
styles.add(ParagraphStyle(
    name="CoverTitle", fontName=BOLD, fontSize=35, leading=38, textColor=WHITE,
))
styles.add(ParagraphStyle(
    name="CoverDeck", fontName=REG, fontSize=12.2, leading=17, textColor=colors.HexColor("#D4D9EB"),
))
styles.add(ParagraphStyle(
    name="CoverMeta", fontName=REG, fontSize=7.6, leading=11, textColor=colors.HexColor("#BBC4D8"),
))


def P(text, style="BodyK"):
    return Paragraph(text, styles[style])


def bullet(text, style="BodyK"):
    return P("<font color='#08786C'><b>•</b></font>  " + text, style)


def card(title, body, width, fill=WHITE):
    content = [P(title, "CardHead"), P(body, "CardBody")]
    t = Table([[content]], colWidths=[width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("BOX", (0, 0), (-1, -1), 0.65, LINE),
        ("ROUNDEDCORNERS", [7, 7, 7, 7]),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def callout(title, text, width, fill=PALE_TEAL, accent=TEAL):
    content = [P(f"<b>{title}</b><br/>{text}", "Callout")]
    t = Table([[content]], colWidths=[width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("BOX", (0, 0), (-1, -1), 0.5, fill),
        ("LINEBEFORE", (0, 0), (0, 0), 3, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 11),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def data_table(headers, rows, widths, font_size=7.8, repeat_rows=1):
    body_style = ParagraphStyle(
        f"TableBody{len(rows)}{font_size}", parent=styles["TableBody"], fontSize=font_size,
        leading=font_size + 2.5,
    )
    head = [Paragraph(str(h), styles["TableHead"]) for h in headers]
    cells = [head]
    for row in rows:
        cells.append([Paragraph(str(c), body_style) for c in row])
    t = Table(cells, colWidths=widths, repeatRows=repeat_rows, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY2),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PAPER]),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def section_title(kicker, title, deck):
    return [P(kicker.upper(), "Kicker"), P(title, "TitleK"), P(deck, "Deck")]


class BrandMark(Flowable):
    def __init__(self, size=28):
        super().__init__()
        self.width = size
        self.height = size
        self.size = size

    def draw(self):
        s = self.size
        c = self.canv
        c.setFillColor(WHITE)
        c.circle(s/2, s/2, s/2, fill=1, stroke=0)
        c.setStrokeColor(TEAL)
        c.setLineWidth(1.2)
        c.circle(s/2, s/2, s*0.37, fill=0, stroke=1)
        c.setStrokeColor(NAVY)
        c.setLineWidth(1.1)
        c.line(s/2, s*0.24, s/2, s*0.68)
        c.line(s/2, s*0.53, s*0.32, s*0.70)
        c.line(s/2, s*0.48, s*0.70, s*0.66)
        c.setFillColor(GOLD)
        c.circle(s*0.32, s*0.70, s*0.035, fill=1, stroke=0)
        c.circle(s*0.70, s*0.66, s*0.035, fill=1, stroke=0)


class CoverTemplate(PageTemplate):
    pass


def draw_cover(canvas: Canvas, doc):
    w, h = A4
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    # A quiet teal glow and restrained gold/teal rule echo the user guide cover.
    canvas.setFillColor(colors.HexColor("#183746"))
    canvas.circle(w*0.92, h*0.93, 120*mm, fill=1, stroke=0)
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, w*0.70, h, fill=1, stroke=0)
    canvas.restoreState()


def draw_interior(canvas: Canvas, doc):
    w, h = A4
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.setFont(BOLD, 7)
    canvas.drawString(19*mm, h-13*mm, "KAGEFLOW")
    canvas.setFillColor(MUTED)
    canvas.setFont(REG, 7)
    canvas.drawRightString(w-19*mm, h-13*mm, "Marketing playbook")
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.45)
    canvas.line(19*mm, h-16*mm, w-19*mm, h-16*mm)
    canvas.line(19*mm, 15*mm, w-19*mm, 15*mm)
    canvas.setFillColor(MUTED)
    canvas.setFont(REG, 6.8)
    canvas.drawString(19*mm, 10*mm, "Kageflow · Pretan Technologies · Marketing team")
    canvas.drawRightString(w-19*mm, 10*mm, f"Page {doc.page-1} of 8")
    canvas.restoreState()


class PlaybookDoc(BaseDocTemplate):
    def __init__(self, filename, **kwargs):
        super().__init__(filename, pagesize=A4, leftMargin=19*mm, rightMargin=19*mm,
                         topMargin=22*mm, bottomMargin=20*mm, **kwargs)
        cover_frame = Frame(19*mm, 18*mm, A4[0]-38*mm, A4[1]-36*mm,
                            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="cover")
        body_frame = Frame(19*mm, 20*mm, A4[0]-38*mm, A4[1]-42*mm,
                           leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="body")
        self.addPageTemplates([
            PageTemplate(id="cover", frames=cover_frame, onPage=draw_cover),
            PageTemplate(id="body", frames=body_frame, onPage=draw_interior),
        ])

    def afterPage(self):
        if self.page == 1:
            self.handle_nextPageTemplate("body")


def flow_row(steps, width):
    cols = len(steps)
    cw = width / cols
    cells = []
    for n, (head, body) in enumerate(steps, 1):
        cells.append([P(f"<font color='#08786C'><b>{n:02d}</b></font>  <b>{head}</b><br/>{body}", "CardBody")])
    t = Table([cells], colWidths=[cw]*cols)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), PAPER),
        ("BOX", (0,0), (-1,-1), 0.6, LINE),
        ("INNERGRID", (0,0), (-1,-1), 0.5, LINE),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 8),
        ("RIGHTPADDING", (0,0), (-1,-1), 8),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
    ]))
    return t


story = []

# Cover
cover_brand = Table([[BrandMark(27), P("<font color='#FFFFFF'><b>Kageflow</b></font>", "CardHead")]], colWidths=[35, 170], hAlign="LEFT")
cover_brand.setStyle(TableStyle([("VALIGN", (0,0), (-1,-1), "MIDDLE"), ("LEFTPADDING", (0,0), (-1,-1), 0), ("RIGHTPADDING", (0,0), (-1,-1), 5), ("TOPPADDING", (0,0), (-1,-1), 0), ("BOTTOMPADDING", (0,0), (-1,-1), 0)]))
story += [Spacer(1, 10*mm), cover_brand, Spacer(1, 21*mm),
          P("MARKETING TEAM PLAYBOOK", "Kicker"),
          P("Marketing with<br/>Kageflow", "CoverTitle"), Spacer(1, 4*mm),
          P("A practical guide to planning campaigns, capturing dealership enquiries and turning interest into sales conversations.", "CoverDeck"),
          Spacer(1, 4*mm)]
accent_rule = Table([["", ""]], colWidths=[31*mm, 18*mm], rowHeights=[1.2*mm], hAlign="LEFT")
accent_rule.setStyle(TableStyle([("BACKGROUND", (0,0), (0,0), TEAL), ("BACKGROUND", (1,0), (1,0), GOLD), ("LEFTPADDING", (0,0), (-1,-1), 0), ("RIGHTPADDING", (0,0), (-1,-1), 0), ("TOPPADDING", (0,0), (-1,-1), 0), ("BOTTOMPADDING", (0,0), (-1,-1), 0)]))
story += [accent_rule, Spacer(1, 6*mm)]
meta = Table([[P("VERSION<br/><b>1.0</b>", "CoverMeta"), P("UPDATED<br/><b>November 2026</b>", "CoverMeta"), P("FOR<br/><b>Marketing and sales teams</b>", "CoverMeta")]], colWidths=[30*mm, 47*mm, 68*mm], hAlign="LEFT")
meta.setStyle(TableStyle([("TEXTCOLOR", (0,0), (-1,-1), WHITE), ("VALIGN", (0,0), (-1,-1), "TOP"), ("LEFTPADDING", (0,0), (-1,-1), 0), ("RIGHTPADDING", (0,0), (-1,-1), 8), ("TOPPADDING", (0,0), (-1,-1), 0), ("BOTTOMPADDING", (0,0), (-1,-1), 0)]))
story += [meta, Spacer(1, 7*mm)]
if DASHBOARD.exists():
    img = Image(str(DASHBOARD), width=175*mm, height=76.2*mm)
    story.append(img)
story += [Spacer(1, 7*mm), P("Pretan Technologies  ·  www.kageflow.co.za  ·  app.kageflow.co.za", "SmallK"), PageBreak()]

# Page 2: System overview
story += section_title("Start here", "How marketing fits into Kageflow", "Kageflow is the shared record for dealership stock, enquiries and follow-up. Marketing creates attention; Kageflow helps the team capture the response and keep it moving.")
usable = A4[0] - 38*mm
gap = 4*mm
cw = (usable - 2*gap) / 3
cards = Table([[card("Create demand", "Run content, ads, promotions and partnerships in the channels your audience uses.", cw), card("Capture interest", "Website forms, WhatsApp, portal emails, Facebook enquiries and staff-entered leads flow into CRM.", cw), card("Move the conversation", "Sales qualify, assign and follow up leads, then progress serious buyers into deals and quotes.", cw)]], colWidths=[cw]*3)
cards.setStyle(TableStyle([("VALIGN", (0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),gap),("TOPPADDING",(0,0),(-1,-1),2),("BOTTOMPADDING",(0,0),(-1,-1),2)]))
story += [cards, Spacer(1, 5*mm), P("The enquiry-to-sale path", "H2K"),
          flow_row([("Promote", "Choose a vehicle or offer and publish through an external channel."), ("Enquire", "A buyer messages, submits a form or calls."), ("Capture", "A lead is recorded with its source and available customer details."), ("Follow up", "Sales qualifies, responds and logs the next action."), ("Review", "The team checks lead quality, appointments and sales outcomes.")], usable),
          Spacer(1, 5*mm)]
two = Table([[card("Kageflow supports", "Stock feeds, CRM lead capture, WhatsApp conversations, lead assignment, deal stages and operational reporting.", (usable-5*mm)/2, PALE_TEAL), card("Your marketing tools still matter", "Plan and publish campaigns in the channels you use. Kageflow is not an ad-buying tool or a bulk campaign scheduler.", (usable-5*mm)/2, PALE_GOLD)]], colWidths=[(usable-5*mm)/2]*2)
two.setStyle(TableStyle([("VALIGN", (0,0),(-1,-1),"TOP"),("LEFTPADDING", (0,0),(-1,-1),0),("RIGHTPADDING", (0,0),(-1,-1),5*mm),("TOPPADDING", (0,0),(-1,-1),0),("BOTTOMPADDING", (0,0),(-1,-1),0)]))
story += [two, Spacer(1, 4*mm), callout("Working agreement", "Marketing owns the campaign brief and creative. Sales owns timely customer follow-up. Both teams review lead quality and outcomes together.", usable), PageBreak()]

# Page 3: Channel map
story += section_title("Channel map", "Where enquiries enter", "Choose channels based on the customer and the vehicle. Make the next step obvious, and make sure replies land with the sales team.")
rows = [
    ("WhatsApp", "Start a direct conversation; answer vehicle questions and arrange a viewing.", "CRM > WhatsApp when the dealership channel is connected and active."),
    ("Dealership website", "Show published stock and invite a buyer to enquire from a car page or contact form.", "Website forms can feed a lead into Kageflow through the Kageflow Connect plugin or site integration."),
    ("Portals", "Promote available vehicles where buyers are already searching.", "A stock feed can share published cars. Portal enquiry emails can be forwarded to a Kageflow lead address."),
    ("Facebook and other social", "Build awareness, promote stock and drive people to a tracked next step.", "Facebook enquiries can enter through forwarded lead emails or the configured integration."),
    ("Phone and walk-ins", "Help buyers who prefer to call or visit in person.", "Staff can create a lead by hand in CRM and record the source and follow-up."),
]
story += [data_table(["CHANNEL", "MARKETING ROLE", "HOW IT CONNECTS TO KAGEFLOW"], rows, [31*mm, 55*mm, usable-86*mm]),
          Spacer(1, 5*mm), P("Stock feeds", "H2K"),
          P("Settings > Listings and leads can generate private JSON, XML or CSV feeds for published vehicles. Coordinate with the website or portal so they know which feed to read. Check the listing, images, price and availability before promoting it.", "BodyK"),
          P("What helps matching", "H2K"),
          bullet("Include the Kageflow stock number in the advert and enquiry prompt (for example: 'Message us about STK-000123')."),
          bullet("When a lead message includes a stock number or VIN, Kageflow can link the enquiry to the vehicle."),
          bullet("Kageflow reuses an open lead when the same person enquires again within its matching window, helping avoid duplicate records."),
          Spacer(1, 4*mm), callout("Before a campaign", "Confirm which channels are actually connected for this dealership. A feature in the platform only captures enquiries after its channel has been configured and tested.", usable, PALE_GOLD, GOLD), PageBreak()]

# Page 4: Campaign planning around stock
story += section_title("Campaign choices", "Start with a dealership need", "A useful campaign connects a real stock or customer need to a clear audience, relevant message and simple next action.")
rows = [
    ("New arrival", "A newly listed vehicle that deserves early attention.", "Fresh photos, key specifications, asking price and viewing CTA."),
    ("Ageing stock", "A vehicle that has been available longer than planned.", "Confirm availability and price; agree the business-approved offer before publishing."),
    ("Price update", "A genuine price change or value proposition.", "Show the current verified price. Remove or update old creative promptly."),
    ("Buyer need", "A category or use case (family, work, first car, off-road).", "Select matching vehicles and explain the relevant features accurately."),
    ("Trade-in or finance enquiry", "A buyer who wants to understand affordability or exchange options.", "Invite a conversation; never promise approval, rates or valuations before assessment."),
]
story += [data_table(["CAMPAIGN ANGLE", "GOOD FIT WHEN", "PREP BEFORE LAUNCH"], rows, [33*mm, 62*mm, usable-95*mm]),
          Spacer(1, 4*mm), P("Build a one-page brief", "H2K")]
check_rows = [
    [P("<b>Objective</b><br/>What business result should change?", "CardBody"), P("<b>Audience</b><br/>Who is most likely to care?", "CardBody")],
    [P("<b>Stock or offer</b><br/>Which vehicle(s), and are they available?", "CardBody"), P("<b>Message and proof</b><br/>What can we say accurately?", "CardBody")],
    [P("<b>Channel and CTA</b><br/>Where will it run, and what should a buyer do?", "CardBody"), P("<b>Owner and timing</b><br/>Who publishes, responds and reviews?", "CardBody")],
]
brief = Table(check_rows, colWidths=[usable/2]*2, rowHeights=[24*mm]*3)
brief.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),WHITE),("GRID",(0,0),(-1,-1),0.6,LINE),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),9),("RIGHTPADDING",(0,0),(-1,-1),9),("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
story += [brief, Spacer(1, 4*mm), callout("Stay within the information you can use", "Marketing should use approved customer-facing vehicle details. Kageflow limits cost and profit visibility to authorized roles; do not seek or share private landed costs in campaign creative.", usable, PALE_GOLD, GOLD), PageBreak()]

# Page 5: Journey and handoff
story += section_title("Make follow-up work", "Design the handoff before publishing", "Every campaign needs a clear owner for the moment a buyer responds. The marketing plan should tell sales what the buyer saw and what to do next.")
story += [flow_row([("Campaign", "External post, advert, email or promotion."), ("CTA", "Message, form, call or visit."), ("Lead", "Capture in CRM; link the stock number where possible."), ("Owner", "Assign manually or use the configured round-robin option."), ("Next step", "Qualify, arrange a viewing, send a quote or close with a reason.")], usable),
          Spacer(1, 5*mm), P("Handoff checklist", "H2K"),
          bullet("Share the campaign name, offer, audience and dates with the sales team before launch."),
          bullet("Tell sales which vehicle(s) the creative promotes and which details to confirm before promising availability."),
          bullet("Agree who checks new leads during business hours, who covers absence and when an enquiry is considered overdue."),
          bullet("Ask sales to record contact attempts, qualification, appointments, quotes and the final outcome in Kageflow."),
          bullet("Review lead quality with marketing. A high enquiry count is not a win if the audience or stock fit is poor."),
          Spacer(1, 4*mm), P("Example campaign message framework", "H2K")]
sample = Table([[P("<b>Opening:</b> Introduce the vehicle or customer benefit.<br/><b>Evidence:</b> Give 2-3 verified details (year, model, mileage, key feature, price).<br/><b>Next step:</b> 'Ask us about STK-000123 or book a viewing.'<br/><b>Link:</b> Use the vehicle page or dealership WhatsApp link.", "CardBody")]], colWidths=[usable])
sample.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),PAPER),("BOX",(0,0),(-1,-1),0.6,LINE),("LEFTPADDING",(0,0),(-1,-1),11),("RIGHTPADDING",(0,0),(-1,-1),11),("TOPPADDING",(0,0),(-1,-1),9),("BOTTOMPADDING",(0,0),(-1,-1),9)]))
story += [sample, Spacer(1, 4*mm), callout("Close the loop", "When the campaign ends, mark or note its name consistently so the team can compare the enquiries and sales it produced.", usable), PageBreak()]

# Page 6: WhatsApp
story += section_title("WhatsApp", "Use conversations with care", "WhatsApp can make it easy for an interested buyer to ask a question. Keep messages relevant, consent-based and connected to a real human follow-up.")
wc = Table([[card("Inbound enquiries", "Once the dealership's WhatsApp Cloud API channel and webhook are connected, incoming messages can create or join a CRM lead.", (usable-5*mm)/2, PALE_TEAL), card("Sales replies", "The team can read and reply from CRM > WhatsApp. Messages and vehicle context stay with the lead.", (usable-5*mm)/2, WHITE)],
            [card("Templates", "Meta-approved templates are needed to start a business conversation or message outside the 24-hour customer-service window.", (usable-5*mm)/2, WHITE), card("Automation", "An admin can configure a welcome reply for new leads and optionally assign new leads round-robin.", (usable-5*mm)/2, WHITE)]], colWidths=[(usable-5*mm)/2]*2)
wc.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),5*mm),("TOPPADDING",(0,0),(-1,-1),2),("BOTTOMPADDING",(0,0),(-1,-1),2)]))
story += [wc, Spacer(1, 5*mm), P("Pre-launch WhatsApp checks", "H2K"),
          bullet("The dealership has connected and tested its own WhatsApp Business number and authorized Meta assets."),
          bullet("The callback URL is verified, the messages webhook field is subscribed, and a real inbound test appears in Kageflow."),
          bullet("The customer has agreed to receive the type of messages planned. Keep a record of consent and honor opt-outs."),
          bullet("Use an approved template for eligible business-initiated follow-ups; do not send bulk marketing from the one-to-one inbox."),
          bullet("A named salesperson will respond to replies and update the lead."),
          Spacer(1, 4*mm), callout("Product readiness", "WhatsApp setup is dealership-specific. Do not promise that lead capture or outbound replies are live until a test message has been received and answered successfully in that dealership's Kageflow workspace.", usable, PALE_GOLD, GOLD), PageBreak()]

# Page 7: worksheet
story += section_title("Planning worksheet", "Campaign brief", "Duplicate this page for each campaign. Keep the brief short enough to use, but specific enough for sales to execute.")
worksheet = [
    [P("<b>Campaign name</b><br/><font color='#657087'>Use one short label across the team.</font>", "CardBody"), P("<b>Business objective</b><br/><font color='#657087'>What should happen more often?</font>", "CardBody")],
    [P("<b>Audience and customer need</b><br/><font color='#657087'>Who is this for? What are they trying to solve?</font>", "CardBody"), P("<b>Vehicle(s) / offer</b><br/><font color='#657087'>Stock numbers, availability, approved price or offer.</font>", "CardBody")],
    [P("<b>Key message and proof</b><br/><font color='#657087'>What can we verify and stand behind?</font>", "CardBody"), P("<b>Channel and CTA</b><br/><font color='#657087'>Where will it run? What action should a buyer take?</font>", "CardBody")],
    [P("<b>Creative and landing destination</b><br/><font color='#657087'>Asset owner, copy, link, UTM or campaign tag if used.</font>", "CardBody"), P("<b>Budget and dates</b><br/><font color='#657087'>Spend, start/end, publishing schedule.</font>", "CardBody")],
    [P("<b>Sales owner and response plan</b><br/><font color='#657087'>Coverage, response expectation and escalation.</font>", "CardBody"), P("<b>Success measure</b><br/><font color='#657087'>Baseline, target and where results are recorded.</font>", "CardBody")],
]
ws = Table(worksheet, colWidths=[usable/2]*2, rowHeights=[25*mm]*5)
ws.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),WHITE),("GRID",(0,0),(-1,-1),0.6,LINE),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),9),("RIGHTPADDING",(0,0),(-1,-1),9),("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
story += [ws, Spacer(1, 4*mm), P("Approval before publishing", "H2K"),
          P("[ ] Stock and price checked  [ ] Claims reviewed  [ ] Creative approved  [ ] Consent path confirmed  [ ] Sales handoff agreed  [ ] Tracking label ready", "SmallK"),
          Spacer(1, 3*mm), callout("Keep customer data in the right place", "Use Kageflow for genuine customer enquiries and follow-up. Do not export or reuse customer contact details for unrelated campaigns without the required permission.", usable, PALE_TEAL), PageBreak()]

# Page 8: measurement
story += section_title("Measurement", "Use outcomes to improve the next plan", "Review the whole path from attention to sale. Agree definitions with sales so the team compares like with like.")
metric_rows = [
    ("Enquiries", "New leads from the campaign period.", "CRM > Leads; filter by source where available. Separate campaign results if you tagged them."),
    ("Qualified leads", "Enquiries that match the target buyer and stock.", "Lead status and salesperson notes."),
    ("Response time", "Time from enquiry received to first human response.", "Compare received and activity/message times; set an internal service target."),
    ("Appointments", "Viewing or test-drive bookings created from the campaign.", "Lead activities and sales team's agreed tally."),
    ("Quotes and sales", "Commercial progress and deals won from the enquiries.", "Pipeline, quotes and orders; confirm campaign linkage with sales."),
    ("Cost per qualified lead", "Campaign spend divided by qualified leads.", "Use external ad spend plus the qualified-lead count; Kageflow does not replace ad-platform billing reports."),
]
story += [data_table(["MEASURE", "WORKING DEFINITION", "WHERE TO CHECK / HOW TO USE IT"], metric_rows, [36*mm, 55*mm, usable-91*mm]),
          Spacer(1, 5*mm), P("Weekly 20-minute review", "H2K"),
          flow_row([("Look", "Check enquiry volume and source."), ("Listen", "Ask sales which leads were relevant and what buyers asked."), ("Learn", "Spot friction: slow reply, weak offer, unavailable stock."), ("Decide", "Adjust message, audience, channel or stock choice."), ("Record", "Write the decision and owner into the next brief.")], usable),
          Spacer(1, 5*mm), callout("Attribution note", "Kageflow captures lead source and details provided by each channel. If your setup does not capture a campaign name automatically, use a consistent campaign label in the brief and sales handoff, then reconcile it during the review.", usable, PALE_GOLD, GOLD), PageBreak()]

# Page 9: starter plan and launch checklist
story += section_title("First month", "A simple rhythm to get started", "Begin with a small number of campaigns the team can follow through. Learn from real enquiries before adding more activity.")
starter_rows = [
    ("Week 1", "Baseline", "Review current stock, lead sources, website and WhatsApp readiness. Agree a lead owner and response plan."),
    ("Week 2", "Stock spotlight", "Promote a small set of verified vehicles with clear stock numbers and one enquiry CTA."),
    ("Week 3", "Audience test", "Compare two relevant messages or audiences through an appropriate channel. Keep the offer and stock constant where possible."),
    ("Week 4", "Review and decide", "Compare qualified enquiries, response, appointments and sales movement. Document what to repeat or change."),
]
story += [data_table(["WHEN", "FOCUS", "TEAM ACTION"], starter_rows, [25*mm, 35*mm, usable-60*mm]),
          Spacer(1, 5*mm), P("Launch-day checklist", "H2K")]
launch_cols = [
    ["Stock is still available; price and specs are checked.", "Creative uses accurate, current customer-facing information.", "Links open on mobile and point to the right vehicle or contact route."],
    ["The campaign name, dates, owner and budget are in the brief.", "Sales knows what is being promoted and who covers new enquiries.", "WhatsApp or website capture was tested for this dealership."],
]
lc = Table([[P("[ ]  "+x, "BodyK") for x in launch_cols[0]], [P("[ ]  "+x, "BodyK") for x in launch_cols[1]]], colWidths=[usable/3]*3)
lc.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),PAPER),("GRID",(0,0),(-1,-1),0.5,LINE),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
story += [lc, Spacer(1, 5*mm), P("The team habit", "H2K"),
          P("A campaign is not finished when the post goes live. It is finished when every resulting enquiry has an owner, a next step and an outcome the team can learn from.", "Deck"),
          Spacer(1, 4*mm), callout("Where to start in Kageflow", "Use CRM > Leads to review enquiries, CRM > WhatsApp for conversations, Settings > Listings and leads for channel and stock-feed setup, and the dashboard to see current lead and pipeline activity.", usable)]


doc = PlaybookDoc(str(OUT), title="Kageflow Marketing Playbook", author="Pretan Technologies")
doc.build(story)
print(OUT)
