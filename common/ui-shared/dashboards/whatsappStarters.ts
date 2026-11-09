// Ready-made WhatsApp messages (MJ, 5 Nov 2026): the wording HMS offers a hotel for every message it sends to its guests and to its companies, in English, Hindi,
// Gujarati and Hinglish. A hotel starts from one (Settings > WhatsApp > Messages), may change the words, and sends it to Meta for approval. The rules every one
// keeps: WhatsApp Business categories (utility for service, marketing only for offers, with STOP), numbered blanks in order of appearance with a sample each,
// no blank at the very start or end, the hotel's name in every message, the one fact first, at most one emoji (none used), no capital-letter shouting.
// Variable order is the same in every language, so a message is filled the same way whatever language the guest reads.

export type StarterLanguage = 'en' | 'hi' | 'gu' | 'hinglish';
export const STARTER_LANGUAGES: readonly StarterLanguage[] = ['en', 'hi', 'gu', 'hinglish'];
export const STARTER_LANGUAGE_NAMES: Record<StarterLanguage, string> = { en: 'English', hi: 'Hindi', gu: 'Gujarati', hinglish: 'Hinglish' };

export type StarterFamily = 'booking' | 'stay' | 'food' | 'billing' | 'company';
export type StarterCategory = 'utility' | 'marketing' | 'authentication';
export type StarterWords = Record<StarterLanguage, string>;
/** What the hotel puts behind a link button: the same link for every guest. */
export type StarterLink = 'directions' | 'review';

export interface StarterVariable {
  /** A field HMS fills by itself (guest_name, hotel_name, room, check_in, check_out) or the plain name staff see. */
  name: string;
  /** The invented sample Meta's reviewers read. */
  example: string;
}

export interface StarterButton {
  kind: 'url' | 'quick_reply';
  text: StarterWords;
  link?: StarterLink;
}

export interface StarterMessage {
  /** The template name at Meta; never changes once hotels use it. */
  key: string;
  family: StarterFamily;
  title: string;
  /** When it goes, in one short line. */
  when: string;
  to: 'guest' | 'company';
  category: StarterCategory;
  variables: StarterVariable[];
  body: StarterWords;
  buttons: StarterButton[];
}

export const STARTER_FAMILIES: { id: StarterFamily; title: string }[] = [
  { id: 'booking', title: 'Bookings' },
  { id: 'stay', title: 'During the stay' },
  { id: 'food', title: 'Food and requests' },
  { id: 'billing', title: 'Bills and payments' },
  { id: 'company', title: 'Companies' },
];

/** Plain names of the fields HMS fills by itself. */
export const VARIABLE_LABELS: Record<string, string> = { guest_name: 'Guest name', hotel_name: 'Hotel name', room: 'Room', check_in: 'Check-in date', check_out: 'Check-out date' };
export const variableLabel = (name: string): string => {
  const known = VARIABLE_LABELS[name];
  if (known) return known;
  const plain = name.replace(/_/g, ' ').trim();
  return plain ? plain[0].toUpperCase() + plain.slice(1) : 'Blank';
};

export const STARTER_LINK_LABELS: Record<StarterLink, { label: string; hint: string }> = {
  directions: { label: 'Map link of the hotel', hint: 'Open the hotel on Google Maps, tap Share and paste the link.' },
  review: { label: 'Review page link', hint: 'The page where guests write a review, for example your Google review link.' },
};

const words = (en: string, hi: string, gu: string, hinglish: string): StarterWords => ({ en, hi, gu, hinglish });

const GUEST = { name: 'guest_name', example: 'Riya Mehta' };
const HOTEL = { name: 'hotel_name', example: 'Kesar Bagh Residency' };

export const WHATSAPP_STARTERS: readonly StarterMessage[] = [
  // ---- bookings ----
  {
    key: 'booking_confirmed',
    family: 'booking',
    title: 'Booking confirmed',
    when: 'As soon as the booking is saved',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, HOTEL, { name: 'check_in', example: '12 Nov 2026' }, { name: 'check_out', example: '14 Nov 2026' }, { name: 'Room type', example: 'Deluxe room, 2 adults' }, { name: 'Booking number', example: 'BK-2611-0042' }],
    body: words(
      'Hello {{1}}, your booking at {{2}} is confirmed.\n\nCheck-in: {{3}}\nCheck-out: {{4}}\nRoom: {{5}}\nBooking number: {{6}}\n\nWe look forward to welcoming you. Reply to this message if you need anything before you arrive.',
      'नमस्ते {{1}}, {{2}} में आपकी बुकिंग पक्की हो गई है।\n\nचेक-इन: {{3}}\nचेक-आउट: {{4}}\nकमरा: {{5}}\nबुकिंग नंबर: {{6}}\n\nआपके स्वागत का इंतज़ार है। आने से पहले कुछ भी चाहिए तो इसी मैसेज का जवाब दें।',
      'નમસ્તે {{1}}, {{2}} માં તમારું બુકિંગ પાકું થઈ ગયું છે.\n\nચેક-ઇન: {{3}}\nચેક-આઉટ: {{4}}\nરૂમ: {{5}}\nબુકિંગ નંબર: {{6}}\n\nતમારું સ્વાગત કરવા અમે આતુર છીએ. આવતા પહેલાં કંઈ પણ જોઈએ તો આ મેસેજનો જવાબ આપો.',
      'Namaste {{1}}, {{2}} mein aapki booking confirm ho gayi hai.\n\nCheck-in: {{3}}\nCheck-out: {{4}}\nRoom: {{5}}\nBooking number: {{6}}\n\nAapka swagat karne ka intezaar hai. Aane se pehle kuch bhi chahiye toh isi message ka reply karein.',
    ),
    buttons: [],
  },
  {
    key: 'pre_arrival',
    family: 'booking',
    title: 'Before arrival',
    when: '48 hours before check-in',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, HOTEL, { name: 'check_in', example: '12 Nov 2026' }, { name: 'Check-in time', example: '12:00 pm' }, { name: 'Hotel address', example: '14 Lake Road, Udaipur 313001' }],
    body: words(
      'Hello {{1}}, we look forward to welcoming you at {{2}} on {{3}}.\n\nCheck-in time: from {{4}}\nAddress: {{5}}\n\nPlease carry a photo ID for every adult guest. Tap the button below for directions.',
      'नमस्ते {{1}}, {{2}} में {{3}} को आपका स्वागत करने का हमें इंतज़ार है।\n\nचेक-इन का समय: {{4}} से\nपता: {{5}}\n\nकृपया हर वयस्क मेहमान का फ़ोटो पहचान पत्र साथ लाएँ। रास्ता देखने के लिए नीचे का बटन दबाएँ।',
      'નમસ્તે {{1}}, {{2}} માં {{3}} ના રોજ તમારું સ્વાગત કરવા અમે આતુર છીએ.\n\nચેક-ઇનનો સમય: {{4}} થી\nસરનામું: {{5}}\n\nદરેક પુખ્ત મહેમાનનું ફોટો ઓળખપત્ર સાથે લાવશો. રસ્તો જોવા માટે નીચેનું બટન દબાવો.',
      'Namaste {{1}}, {{2}} mein {{3}} ko aapka swagat karne ka intezaar hai.\n\nCheck-in time: {{4}} se\nAddress: {{5}}\n\nHar adult guest ka photo ID saath laayein. Raasta dekhne ke liye neeche ka button dabayein.',
    ),
    buttons: [{ kind: 'url', link: 'directions', text: words('Get directions', 'रास्ता देखें', 'રસ્તો જુઓ', 'Raasta dekhein') }],
  },
  {
    key: 'online_check_in',
    family: 'booking',
    title: 'Online check-in link',
    when: 'With the booking, or the day before arrival',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, HOTEL, { name: 'check_in', example: '12 Nov 2026' }, { name: 'Check-in link', example: 'https://easyhotel.in/c/7KQ2M' }],
    body: words(
      'Hello {{1}}, you can check in online for your stay at {{2}} on {{3}}.\n\nAdd your details and ID photo here: {{4}}\n\nIt takes about 2 minutes and saves you time at the front desk.',
      'नमस्ते {{1}}, {{2}} में {{3}} के आपके ठहराव के लिए आप ऑनलाइन चेक-इन कर सकते हैं।\n\nअपनी जानकारी और पहचान पत्र की फ़ोटो यहाँ दें: {{4}}\n\nइसमें लगभग 2 मिनट लगते हैं और रिसेप्शन पर आपका समय बचता है।',
      'નમસ્તે {{1}}, {{2}} માં {{3}} ના તમારા રોકાણ માટે તમે ઓનલાઇન ચેક-ઇન કરી શકો છો.\n\nતમારી વિગતો અને ઓળખપત્રનો ફોટો અહીં આપો: {{4}}\n\nઆમાં આશરે 2 મિનિટ લાગે છે અને રિસેપ્શન પર તમારો સમય બચે છે.',
      'Namaste {{1}}, {{2}} mein {{3}} ke aapke stay ke liye aap online check-in kar sakte hain.\n\nApni details aur ID photo yahan dein: {{4}}\n\nIsmein lagbhag 2 minute lagte hain aur reception par aapka time bachta hai.',
    ),
    buttons: [],
  },
  {
    key: 'booking_changed',
    family: 'booking',
    title: 'Booking changed',
    when: 'When dates or the room change',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, { name: 'Booking number', example: 'BK-2611-0042' }, HOTEL, { name: 'check_in', example: '13 Nov 2026' }, { name: 'check_out', example: '15 Nov 2026' }, { name: 'Room type', example: 'Deluxe room, 2 adults' }],
    body: words(
      'Hello {{1}}, your booking {{2}} at {{3}} has been changed.\n\nCheck-in: {{4}}\nCheck-out: {{5}}\nRoom: {{6}}\n\nIf anything here is not right, reply to this message and we will correct it.',
      'नमस्ते {{1}}, आपकी बुकिंग {{2}} ({{3}}) में बदलाव किया गया है।\n\nचेक-इन: {{4}}\nचेक-आउट: {{5}}\nकमरा: {{6}}\n\nअगर कुछ ग़लत हो तो इसी मैसेज का जवाब दें, हम ठीक कर देंगे।',
      'નમસ્તે {{1}}, તમારા બુકિંગ {{2}} ({{3}}) માં ફેરફાર કરવામાં આવ્યો છે.\n\nચેક-ઇન: {{4}}\nચેક-આઉટ: {{5}}\nરૂમ: {{6}}\n\nજો કંઈ ખોટું હોય તો આ મેસેજનો જવાબ આપો, અમે સુધારી દઈશું.',
      'Namaste {{1}}, aapki booking {{2}} ({{3}}) mein badlaav kiya gaya hai.\n\nCheck-in: {{4}}\nCheck-out: {{5}}\nRoom: {{6}}\n\nAgar kuch galat ho toh isi message ka reply karein, hum theek kar denge.',
    ),
    buttons: [],
  },
  {
    key: 'booking_cancelled',
    family: 'booking',
    title: 'Booking cancelled',
    when: 'When the booking is cancelled',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, { name: 'Booking number', example: 'BK-2611-0042' }, HOTEL, { name: 'check_in', example: '12 Nov 2026' }, { name: 'Refund', example: '₹2,000.00' }],
    body: words(
      'Hello {{1}}, your booking {{2}} at {{3}} for {{4}} is cancelled.\n\nRefund: {{5}}\nAny refund goes back to the account you paid from within 7 working days.\n\nWe hope to welcome you another time.',
      'नमस्ते {{1}}, आपकी बुकिंग {{2}} ({{3}}, {{4}}) रद्द कर दी गई है।\n\nरिफ़ंड: {{5}}\nरिफ़ंड 7 कामकाजी दिनों में उसी खाते में लौटेगा जिससे भुगतान हुआ था।\n\nउम्मीद है फिर कभी आपका स्वागत करेंगे।',
      'નમસ્તે {{1}}, તમારું બુકિંગ {{2}} ({{3}}, {{4}}) રદ કરવામાં આવ્યું છે.\n\nરિફંડ: {{5}}\nરિફંડ 7 કામકાજના દિવસોમાં જે ખાતામાંથી ચુકવણી થઈ હતી તેમાં પાછું જમા થશે.\n\nફરી ક્યારેક તમારું સ્વાગત કરવાની આશા છે.',
      'Namaste {{1}}, aapki booking {{2}} ({{3}}, {{4}}) cancel ho gayi hai.\n\nRefund: {{5}}\nRefund 7 working days mein usi account mein wapas aayega jisse payment hua tha.\n\nUmmeed hai phir kabhi aapka swagat karenge.',
    ),
    buttons: [],
  },
  {
    key: 'no_show',
    family: 'booking',
    title: 'No-show',
    when: 'The morning after a guest did not arrive',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, HOTEL, { name: 'check_in', example: '12 Nov 2026' }, { name: 'Booking number', example: 'BK-2611-0042' }, { name: 'No-show charge', example: '₹3,540.00' }],
    body: words(
      'Hello {{1}}, we were expecting you at {{2}} on {{3}}. As you did not arrive, booking {{4}} is marked as a no-show.\n\nNo-show charge: {{5}}\n\nIf your plans changed, reply to this message and we will help you book new dates.',
      'नमस्ते {{1}}, {{2}} में {{3}} को हम आपका इंतज़ार कर रहे थे। आप नहीं पहुँचे, इसलिए बुकिंग {{4}} को नो-शो माना गया है।\n\nनो-शो शुल्क: {{5}}\n\nअगर आपका प्लान बदल गया है तो इसी मैसेज का जवाब दें, हम नई तारीख़ों की बुकिंग में मदद करेंगे।',
      'નમસ્તે {{1}}, {{2}} માં {{3}} ના રોજ અમે તમારી રાહ જોતા હતા. તમે આવ્યા નહીં, તેથી બુકિંગ {{4}} નો-શો ગણાયું છે.\n\nનો-શો ચાર્જ: {{5}}\n\nજો તમારો પ્લાન બદલાયો હોય તો આ મેસેજનો જવાબ આપો, નવી તારીખોના બુકિંગમાં અમે મદદ કરીશું.',
      'Namaste {{1}}, {{2}} mein {{3}} ko hum aapka intezaar kar rahe the. Aap nahi pahunche, isliye booking {{4}} no-show maani gayi hai.\n\nNo-show charge: {{5}}\n\nAgar aapka plan badal gaya hai toh isi message ka reply karein, hum nayi dates ki booking mein madad karenge.',
    ),
    buttons: [],
  },

  // ---- during the stay ----
  {
    key: 'check_in_welcome',
    family: 'stay',
    title: 'Welcome at check-in',
    when: 'As soon as the guest is checked in',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, HOTEL, { name: 'room', example: '204' }, { name: 'Wi-Fi name', example: 'KesarBagh-Guest' }, { name: 'Wi-Fi password', example: 'lake2611' }, { name: 'Check-out', example: '14 Nov 2026, 11:00 am' }, { name: 'Guest portal link', example: 'https://easyhotel.in/g/R7T4' }],
    body: words(
      'Hello {{1}}, welcome to {{2}}. Your room is {{3}}.\n\nWi-Fi: {{4}}\nWi-Fi password: {{5}}\nCheck-out: {{6}}\n\nOrder food, ask for anything or see your bill here: {{7}}\n\nWe wish you a pleasant stay.',
      'नमस्ते {{1}}, {{2}} में आपका स्वागत है। आपका कमरा {{3}} है।\n\nवाई-फ़ाई: {{4}}\nवाई-फ़ाई पासवर्ड: {{5}}\nचेक-आउट: {{6}}\n\nखाना मँगाएँ, कुछ भी माँगें या अपना बिल देखें: {{7}}\n\nआपका ठहराव सुखद हो।',
      'નમસ્તે {{1}}, {{2}} માં તમારું સ્વાગત છે. તમારો રૂમ {{3}} છે.\n\nવાઇ-ફાઇ: {{4}}\nવાઇ-ફાઇ પાસવર્ડ: {{5}}\nચેક-આઉટ: {{6}}\n\nજમવાનું મંગાવો, કંઈ પણ માંગો કે તમારું બિલ જુઓ: {{7}}\n\nતમારું રોકાણ સુખદ રહે.',
      'Namaste {{1}}, {{2}} mein aapka swagat hai. Aapka room {{3}} hai.\n\nWi-Fi: {{4}}\nWi-Fi password: {{5}}\nCheck-out: {{6}}\n\nKhana mangwayein, kuch bhi maangein ya apna bill dekhein: {{7}}\n\nAapka stay sukhad rahe.',
    ),
    buttons: [],
  },
  {
    key: 'check_out_thanks',
    family: 'stay',
    title: 'Thanks at check-out',
    when: 'When the guest checks out',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, HOTEL, { name: 'Bill number', example: 'INV/2026-27/0418' }, { name: 'Amount paid', example: '₹8,260.00' }],
    body: words(
      'Thank you for staying with us, {{1}}. Your check-out from {{2}} is complete.\n\nBill number: {{3}}\nAmount paid: {{4}}\n\nA copy of the bill is in your email. If you enjoyed your stay, please leave us a review with the button below.',
      'हमारे साथ ठहरने के लिए धन्यवाद, {{1}}। {{2}} से आपका चेक-आउट पूरा हो गया है।\n\nबिल नंबर: {{3}}\nभुगतान की गई राशि: {{4}}\n\nबिल की कॉपी आपके ईमेल में है। अगर ठहराव अच्छा लगा हो तो नीचे के बटन से हमें रिव्यू दें।',
      'અમારી સાથે રોકાવા બદલ આભાર, {{1}}. {{2}} માંથી તમારું ચેક-આઉટ પૂરું થયું છે.\n\nબિલ નંબર: {{3}}\nચૂકવેલી રકમ: {{4}}\n\nબિલની કોપી તમારા ઈમેલમાં છે. રોકાણ ગમ્યું હોય તો નીચેના બટનથી અમને રિવ્યૂ આપો.',
      'Hamare saath rukne ke liye dhanyavaad, {{1}}. {{2}} se aapka check-out poora ho gaya hai.\n\nBill number: {{3}}\nPaid amount: {{4}}\n\nBill ki copy aapke email mein hai. Agar stay accha laga ho toh neeche ke button se humein review dein.',
    ),
    buttons: [{ kind: 'url', link: 'review', text: words('Leave a review', 'रिव्यू दें', 'રિવ્યૂ આપો', 'Review dein') }],
  },
  {
    key: 'return_offer',
    family: 'stay',
    title: 'Offer for the next stay',
    when: 'Sent by the hotel to past guests who agreed to offers',
    to: 'guest',
    category: 'marketing',
    variables: [GUEST, HOTEL, { name: 'Offer', example: '15% off' }, { name: 'Offer valid until', example: '31 Jan 2027' }],
    body: words(
      'Hello {{1}}, thank you for choosing {{2}} before. Book your next stay directly with us and get {{3}} on the room rate, for stays until {{4}}.\n\nTap Book my stay and our team will help you pick your dates.\n\nReply STOP to stop offers.',
      'नमस्ते {{1}}, पहले {{2}} चुनने के लिए धन्यवाद। अगली बार सीधे हमारे साथ बुक करें और कमरे के किराए पर {{3}} पाएँ, {{4}} तक के ठहराव के लिए।\n\nस्टे बुक करें दबाएँ, हमारी टीम तारीख़ चुनने में मदद करेगी।\n\nऑफ़र बंद करने के लिए STOP लिखकर भेजें।',
      'નમસ્તે {{1}}, અગાઉ {{2}} પસંદ કરવા બદલ આભાર. આગલી વખતે સીધું અમારી સાથે બુક કરો અને રૂમના ભાડા પર {{3}} મેળવો, {{4}} સુધીના રોકાણ માટે.\n\nસ્ટે બુક કરો દબાવો, અમારી ટીમ તારીખ પસંદ કરવામાં મદદ કરશે.\n\nઓફર બંધ કરવા STOP લખીને મોકલો.',
      'Namaste {{1}}, pehle {{2}} chunne ke liye dhanyavaad. Agli baar seedha hamare saath book karein aur room rate par {{3}} paayein, {{4}} tak ke stay ke liye.\n\nStay book karein dabayein, hamari team dates chunne mein madad karegi.\n\nOffers band karne ke liye STOP likhkar bhejein.',
    ),
    buttons: [
      { kind: 'quick_reply', text: words('Book my stay', 'स्टे बुक करें', 'સ્ટે બુક કરો', 'Stay book karein') },
      { kind: 'quick_reply', text: words('Stop offers', 'ऑफ़र बंद करें', 'ઓફર બંધ કરો', 'Offers band karein') },
    ],
  },

  // ---- food and requests ----
  {
    key: 'food_order_received',
    family: 'food',
    title: 'Food order received',
    when: 'When the kitchen takes the order',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, { name: 'Order number', example: 'KOT-118' }, HOTEL, { name: 'Items', example: '2 Masala dosa, 1 Filter coffee' }, { name: 'Total', example: '₹340.00' }],
    body: words(
      'Hello {{1}}, your order {{2}} at {{3}} is received.\n\nItems: {{4}}\nTotal: {{5}}\n\nThe kitchen is preparing it. We will tell you when it is on its way.',
      'नमस्ते {{1}}, आपका ऑर्डर {{2}} ({{3}}) मिल गया है।\n\nआइटम: {{4}}\nकुल: {{5}}\n\nकिचन में तैयारी शुरू हो गई है। ऑर्डर निकलते ही हम आपको बताएँगे।',
      'નમસ્તે {{1}}, તમારો ઓર્ડર {{2}} ({{3}}) મળી ગયો છે.\n\nઆઇટમ: {{4}}\nકુલ: {{5}}\n\nકિચનમાં તૈયારી શરૂ થઈ ગઈ છે. ઓર્ડર નીકળતાં જ અમે તમને જણાવીશું.',
      'Namaste {{1}}, aapka order {{2}} ({{3}}) mil gaya hai.\n\nItems: {{4}}\nTotal: {{5}}\n\nKitchen mein taiyaari shuru ho gayi hai. Order nikalte hi hum aapko batayenge.',
    ),
    buttons: [],
  },
  {
    key: 'food_order_ready',
    family: 'food',
    title: 'Food order on its way',
    when: 'When the order leaves the kitchen',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, { name: 'Order number', example: 'KOT-118' }, HOTEL, { name: 'room', example: '204' }, { name: 'Minutes', example: '10' }],
    body: words(
      'Hello {{1}}, your order {{2}} from {{3}} is ready and on its way to room {{4}}. It should reach you in about {{5}} minutes.',
      'नमस्ते {{1}}, आपका ऑर्डर {{2}} ({{3}}) तैयार है और कमरा {{4}} की ओर आ रहा है। लगभग {{5}} मिनट में पहुँच जाएगा।',
      'નમસ્તે {{1}}, તમારો ઓર્ડર {{2}} ({{3}}) તૈયાર છે અને રૂમ {{4}} તરફ આવી રહ્યો છે. આશરે {{5}} મિનિટમાં પહોંચી જશે.',
      'Namaste {{1}}, aapka order {{2}} ({{3}}) taiyaar hai aur room {{4}} ki taraf aa raha hai. Lagbhag {{5}} minute mein pahunch jayega.',
    ),
    buttons: [],
  },
  {
    key: 'food_order_delivered',
    family: 'food',
    title: 'Food order delivered',
    when: 'When the order reaches the room',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, { name: 'Order number', example: 'KOT-118' }, { name: 'room', example: '204' }, { name: 'Amount', example: '₹340.00' }, HOTEL],
    body: words(
      'Hello {{1}}, your order {{2}} has been delivered to room {{3}}. Enjoy your meal.\n\nAdded to your room bill: {{4}}\n\nIf anything is missing, reply to this message and the {{5}} team will sort it out.',
      'नमस्ते {{1}}, आपका ऑर्डर {{2}} कमरा {{3}} में पहुँचा दिया गया है। भोजन का आनंद लें।\n\nरूम बिल में जोड़ा गया: {{4}}\n\nकुछ कम हो तो इसी मैसेज का जवाब दें, {{5}} की टीम तुरंत देख लेगी।',
      'નમસ્તે {{1}}, તમારો ઓર્ડર {{2}} રૂમ {{3}} માં પહોંચાડી દીધો છે. ભોજનનો આનંદ માણો.\n\nરૂમ બિલમાં ઉમેર્યું: {{4}}\n\nકંઈ ખૂટતું હોય તો આ મેસેજનો જવાબ આપો, {{5}} ની ટીમ તરત જોઈ લેશે.',
      'Namaste {{1}}, aapka order {{2}} room {{3}} mein pahuncha diya gaya hai. Khane ka anand lijiye.\n\nRoom bill mein joda gaya: {{4}}\n\nKuch kam ho toh isi message ka reply karein, {{5}} ki team turant dekh legi.',
    ),
    buttons: [],
  },
  {
    key: 'request_received',
    family: 'food',
    title: 'Request received',
    when: 'When a guest asks for something',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, HOTEL, { name: 'Request', example: '2 extra towels' }, { name: 'room', example: '204' }],
    body: words(
      'Hello {{1}}, {{2}} has received your request: {{3}}, room {{4}}.\n\nOur team is on it. We will tell you here as soon as it is done.',
      'नमस्ते {{1}}, {{2}} को आपका अनुरोध मिल गया है: {{3}}, कमरा {{4}}।\n\nहमारी टीम इस पर काम कर रही है। काम पूरा होते ही हम यहीं बताएँगे।',
      'નમસ્તે {{1}}, {{2}} ને તમારી વિનંતી મળી ગઈ છે: {{3}}, રૂમ {{4}}.\n\nઅમારી ટીમ તેના પર કામ કરી રહી છે. કામ પૂરું થતાં જ અમે અહીં જણાવીશું.',
      'Namaste {{1}}, {{2}} ko aapki request mil gayi hai: {{3}}, room {{4}}.\n\nHamari team is par kaam kar rahi hai. Kaam poora hote hi hum yahin batayenge.',
    ),
    buttons: [],
  },
  {
    key: 'request_done',
    family: 'food',
    title: 'Request done',
    when: 'When the request is marked done',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, { name: 'Request', example: '2 extra towels' }, { name: 'room', example: '204' }, HOTEL],
    body: words(
      'Hello {{1}}, your request is done: {{2}}, room {{3}}.\n\nIf anything is still not right, reply to this message and the {{4}} team will help straight away.',
      'नमस्ते {{1}}, आपका अनुरोध पूरा हो गया है: {{2}}, कमरा {{3}}।\n\nअगर अब भी कुछ ठीक न हो तो इसी मैसेज का जवाब दें, {{4}} की टीम तुरंत मदद करेगी।',
      'નમસ્તે {{1}}, તમારી વિનંતી પૂરી થઈ ગઈ છે: {{2}}, રૂમ {{3}}.\n\nજો હજી પણ કંઈ બરાબર ન હોય તો આ મેસેજનો જવાબ આપો, {{4}} ની ટીમ તરત મદદ કરશે.',
      'Namaste {{1}}, aapki request poori ho gayi hai: {{2}}, room {{3}}.\n\nAgar ab bhi kuch theek na ho toh isi message ka reply karein, {{4}} ki team turant madad karegi.',
    ),
    buttons: [],
  },

  // ---- bills and payments ----
  {
    key: 'bill_ready',
    family: 'billing',
    title: 'Bill ready, with payment link',
    when: 'When the bill is made, before check-out',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, HOTEL, { name: 'Bill number', example: 'INV/2026-27/0418' }, { name: 'Amount due', example: '₹8,260.00' }, { name: 'Payment link', example: 'https://easyhotel.in/p/Q8D3' }],
    body: words(
      'Hello {{1}}, your bill from {{2}} is ready.\n\nBill number: {{3}}\nAmount due: {{4}}\n\nSee the full bill and pay securely here: {{5}}\n\nReply to this message if anything looks wrong.',
      'नमस्ते {{1}}, {{2}} का आपका बिल तैयार है।\n\nबिल नंबर: {{3}}\nबकाया राशि: {{4}}\n\nपूरा बिल देखें और सुरक्षित भुगतान करें: {{5}}\n\nकुछ ग़लत लगे तो इसी मैसेज का जवाब दें।',
      'નમસ્તે {{1}}, {{2}} નું તમારું બિલ તૈયાર છે.\n\nબિલ નંબર: {{3}}\nબાકી રકમ: {{4}}\n\nઆખું બિલ જુઓ અને સુરક્ષિત ચુકવણી કરો: {{5}}\n\nકંઈ ખોટું લાગે તો આ મેસેજનો જવાબ આપો.',
      'Namaste {{1}}, {{2}} ka aapka bill taiyaar hai.\n\nBill number: {{3}}\nBaaki amount: {{4}}\n\nPoora bill dekhein aur safe payment karein: {{5}}\n\nKuch galat lage toh isi message ka reply karein.',
    ),
    buttons: [],
  },
  {
    key: 'advance_received',
    family: 'billing',
    title: 'Advance received',
    when: 'When an advance for a booking is paid',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, { name: 'Amount', example: '₹2,000.00' }, { name: 'Booking number', example: 'BK-2611-0042' }, HOTEL, { name: 'Balance due', example: '₹5,080.00' }],
    body: words(
      'Hello {{1}}, we have received your advance of {{2}} for booking {{3}} at {{4}}. Thank you.\n\nBalance to pay at the hotel: {{5}}\n\nKeep this message for your records.',
      'नमस्ते {{1}}, आपका {{2}} का एडवांस बुकिंग {{3}} ({{4}}) के लिए मिल गया है। धन्यवाद।\n\nहोटल में देना बाकी: {{5}}\n\nयह मैसेज अपने रिकॉर्ड के लिए रखें।',
      'નમસ્તે {{1}}, તમારું {{2}} નું એડવાન્સ બુકિંગ {{3}} ({{4}}) માટે મળી ગયું છે. આભાર.\n\nહોટેલ પર ચૂકવવાનું બાકી: {{5}}\n\nઆ મેસેજ તમારા રેકોર્ડ માટે સાચવી રાખો.',
      'Namaste {{1}}, aapka {{2}} ka advance booking {{3}} ({{4}}) ke liye mil gaya hai. Dhanyavaad.\n\nHotel mein dena baaki: {{5}}\n\nYeh message apne record ke liye rakhein.',
    ),
    buttons: [],
  },
  {
    key: 'payment_received',
    family: 'billing',
    title: 'Payment received',
    when: 'When a payment is recorded',
    to: 'guest',
    category: 'utility',
    variables: [GUEST, { name: 'Amount', example: '₹8,260.00' }, HOTEL, { name: 'Receipt number', example: 'RCT-2611-0093' }, { name: 'Paid on', example: '05 Nov 2026, 3:05 pm' }, { name: 'Balance due', example: '₹0.00' }],
    body: words(
      'Hello {{1}}, we have received your payment of {{2}} at {{3}}. Thank you.\n\nReceipt number: {{4}}\nPaid on: {{5}}\nBalance due: {{6}}\n\nKeep this message for your records.',
      'नमस्ते {{1}}, आपका {{2}} का भुगतान {{3}} को मिल गया है। धन्यवाद।\n\nरसीद नंबर: {{4}}\nभुगतान की तारीख़: {{5}}\nबाकी राशि: {{6}}\n\nयह मैसेज अपने रिकॉर्ड के लिए रखें।',
      'નમસ્તે {{1}}, તમારી {{2}} ની ચુકવણી {{3}} ને મળી ગઈ છે. આભાર.\n\nરસીદ નંબર: {{4}}\nચુકવણીની તારીખ: {{5}}\nબાકી રકમ: {{6}}\n\nઆ મેસેજ તમારા રેકોર્ડ માટે સાચવી રાખો.',
      'Namaste {{1}}, aapka {{2}} ka payment {{3}} ko mil gaya hai. Dhanyavaad.\n\nReceipt number: {{4}}\nPayment date: {{5}}\nBaaki amount: {{6}}\n\nYeh message apne record ke liye rakhein.',
    ),
    buttons: [],
  },

  // ---- companies (to the company's accounts contact) ----
  {
    key: 'company_bill_sent',
    family: 'company',
    title: 'Bill sent to a company',
    when: 'When a company bill is emailed',
    to: 'company',
    category: 'utility',
    variables: [{ name: 'Contact name', example: 'Neha Joshi' }, HOTEL, { name: 'Company name', example: 'Northwind Textiles Pvt Ltd' }, { name: 'Bill number', example: 'INV/2026-27/0421' }, { name: 'Stay', example: 'Arjun Rao, 10 Nov 2026 to 12 Nov 2026' }, { name: 'Amount', example: '₹11,800.00' }, { name: 'Due date', example: '10 Dec 2026' }],
    body: words(
      'Hello {{1}}, {{2}} has emailed the bill for {{3}}.\n\nBill number: {{4}}\nStay: {{5}}\nAmount: {{6}}\nDue by: {{7}}\n\nReply to this message if you need a copy or have a question.',
      'नमस्ते {{1}}, {{2}} ने {{3}} का बिल ईमेल कर दिया है।\n\nबिल नंबर: {{4}}\nठहराव: {{5}}\nराशि: {{6}}\nभुगतान की आख़िरी तारीख़: {{7}}\n\nकॉपी चाहिए या कोई सवाल हो तो इसी मैसेज का जवाब दें।',
      'નમસ્તે {{1}}, {{2}} એ {{3}} નું બિલ ઈમેલ કરી દીધું છે.\n\nબિલ નંબર: {{4}}\nરોકાણ: {{5}}\nરકમ: {{6}}\nચુકવણીની છેલ્લી તારીખ: {{7}}\n\nકોપી જોઈએ કે કોઈ પ્રશ્ન હોય તો આ મેસેજનો જવાબ આપો.',
      'Namaste {{1}}, {{2}} ne {{3}} ka bill email kar diya hai.\n\nBill number: {{4}}\nStay: {{5}}\nAmount: {{6}}\nDue date: {{7}}\n\nCopy chahiye ya koi sawaal ho toh isi message ka reply karein.',
    ),
    buttons: [],
  },
  {
    key: 'company_payment_due',
    family: 'company',
    title: 'Payment reminder to a company',
    when: 'On the due date, then every 7 days until paid',
    to: 'company',
    category: 'utility',
    variables: [{ name: 'Contact name', example: 'Neha Joshi' }, HOTEL, { name: 'Bill number', example: 'INV/2026-27/0421' }, { name: 'Company name', example: 'Northwind Textiles Pvt Ltd' }, { name: 'Amount due', example: '₹11,800.00' }, { name: 'Due date', example: '10 Dec 2026' }],
    body: words(
      'Hello {{1}}, a reminder from {{2}}: bill {{3}} ({{4}}) is due for payment.\n\nAmount due: {{5}}\nDue date: {{6}}\n\nIf you have already paid, please reply with the payment reference and we will match it.',
      'नमस्ते {{1}}, {{2}} की ओर से याद दिलाना: बिल {{3}} ({{4}}) का भुगतान बाकी है।\n\nबकाया राशि: {{5}}\nआख़िरी तारीख़: {{6}}\n\nअगर भुगतान हो चुका है तो पेमेंट रेफ़रेंस इसी मैसेज के जवाब में भेजें, हम मिला लेंगे।',
      'નમસ્તે {{1}}, {{2}} તરફથી યાદ અપાવીએ છીએ: બિલ {{3}} ({{4}}) ની ચુકવણી બાકી છે.\n\nબાકી રકમ: {{5}}\nછેલ્લી તારીખ: {{6}}\n\nજો ચુકવણી થઈ ગઈ હોય તો પેમેન્ટ રેફરન્સ આ મેસેજના જવાબમાં મોકલો, અમે મેળવી લઈશું.',
      'Namaste {{1}}, {{2}} ki taraf se reminder: bill {{3}} ({{4}}) ka payment baaki hai.\n\nBaaki amount: {{5}}\nDue date: {{6}}\n\nAgar payment ho chuka hai toh payment reference isi message ke reply mein bhejein, hum match kar lenge.',
    ),
    buttons: [],
  },
  {
    key: 'company_payment_received',
    family: 'company',
    title: 'Payment received from a company',
    when: 'When a company payment is recorded',
    to: 'company',
    category: 'utility',
    variables: [{ name: 'Contact name', example: 'Neha Joshi' }, HOTEL, { name: 'Amount', example: '₹11,800.00' }, { name: 'Company name', example: 'Northwind Textiles Pvt Ltd' }, { name: 'Bills', example: 'INV/2026-27/0421' }, { name: 'Received on', example: '05 Nov 2026' }, { name: 'Balance due', example: '₹0.00' }],
    body: words(
      'Hello {{1}}, {{2}} has received {{3}} from {{4}}. Thank you.\n\nFor bills: {{5}}\nReceived on: {{6}}\nBalance due: {{7}}\n\nThe receipt has been sent to your email.',
      'नमस्ते {{1}}, {{2}} को {{3}} का भुगतान {{4}} से मिल गया है। धन्यवाद।\n\nबिल: {{5}}\nप्राप्ति की तारीख़: {{6}}\nबाकी राशि: {{7}}\n\nरसीद आपके ईमेल पर भेज दी गई है।',
      'નમસ્તે {{1}}, {{2}} ને {{3}} ની ચુકવણી {{4}} તરફથી મળી ગઈ છે. આભાર.\n\nબિલ: {{5}}\nમળ્યાની તારીખ: {{6}}\nબાકી રકમ: {{7}}\n\nરસીદ તમારા ઈમેલ પર મોકલી દીધી છે.',
      'Namaste {{1}}, {{2}} ko {{3}} ka payment {{4}} se mil gaya hai. Dhanyavaad.\n\nBills: {{5}}\nReceived on: {{6}}\nBaaki amount: {{7}}\n\nReceipt aapke email par bhej di gayi hai.',
    ),
    buttons: [],
  },
  {
    key: 'company_statement',
    family: 'company',
    title: 'Account statement to a company',
    when: 'When the statement is emailed, usually monthly',
    to: 'company',
    category: 'utility',
    variables: [{ name: 'Contact name', example: 'Neha Joshi' }, { name: 'Company name', example: 'Northwind Textiles Pvt Ltd' }, HOTEL, { name: 'Period', example: '01 Oct 2026 to 31 Oct 2026' }, { name: 'Balance due', example: '₹23,600.00' }],
    body: words(
      'Hello {{1}}, the account statement of {{2}} with {{3}} has been sent to your email.\n\nPeriod: {{4}}\nBalance due: {{5}}\n\nReply to this message if any entry needs a check.',
      'नमस्ते {{1}}, {{2}} का {{3}} के साथ खाते का स्टेटमेंट आपके ईमेल पर भेज दिया गया है।\n\nअवधि: {{4}}\nबाकी राशि: {{5}}\n\nकिसी एंट्री की जाँच करवानी हो तो इसी मैसेज का जवाब दें।',
      'નમસ્તે {{1}}, {{2}} નું {{3}} સાથેના ખાતાનું સ્ટેટમેન્ટ તમારા ઈમેલ પર મોકલી દીધું છે.\n\nસમયગાળો: {{4}}\nબાકી રકમ: {{5}}\n\nકોઈ એન્ટ્રી તપાસવી હોય તો આ મેસેજનો જવાબ આપો.',
      'Namaste {{1}}, {{2}} ka {{3}} ke saath account statement aapke email par bhej diya gaya hai.\n\nPeriod: {{4}}\nBaaki amount: {{5}}\n\nKisi entry ko check karwana ho toh isi message ka reply karein.',
    ),
    buttons: [],
  },
];

/** The desk's ready-made quick replies: short free texts staff insert while a chat is open. The hotel changes the times and ways to pay to its own. */
export interface QuickReplyStarter {
  key: string;
  title: StarterWords;
  body: StarterWords;
}

export const QUICK_REPLY_STARTERS: readonly QuickReplyStarter[] = [
  {
    key: 'thanks',
    title: words('Thank you', 'धन्यवाद', 'આભાર', 'Dhanyavaad'),
    body: words('Thank you for your message. We will reply shortly.', 'आपके मैसेज के लिए धन्यवाद। हम जल्द ही जवाब देंगे।', 'તમારા મેસેજ બદલ આભાર. અમે થોડી વારમાં જવાબ આપીશું.', 'Aapke message ke liye dhanyavaad. Hum jaldi reply karenge.'),
  },
  {
    key: 'will_check',
    title: words('Checking', 'जाँच रहे हैं', 'તપાસી રહ્યા છીએ', 'Check kar rahe hain'),
    body: words('We are checking this for you and will reply within 15 minutes.', 'हम आपके लिए यह देख रहे हैं और 15 मिनट में जवाब देंगे।', 'અમે તમારા માટે આ તપાસી રહ્યા છીએ અને 15 મિનિટમાં જવાબ આપીશું.', 'Hum aapke liye check kar rahe hain aur 15 minute mein reply karenge.'),
  },
  {
    key: 'timings',
    title: words('Check-in and check-out time', 'चेक-इन और चेक-आउट का समय', 'ચેક-ઇન અને ચેક-આઉટનો સમય', 'Check-in aur check-out time'),
    body: words(
      'Check-in is from 12:00 pm and check-out is by 11:00 am. Early check-in or late check-out depends on availability; tell us your time and we will try.',
      'चेक-इन दोपहर 12:00 बजे से है और चेक-आउट सुबह 11:00 बजे तक। जल्दी चेक-इन या देर से चेक-आउट कमरे की उपलब्धता पर निर्भर है; अपना समय बताइए, हम कोशिश करेंगे।',
      'ચેક-ઇન બપોરે 12:00 વાગ્યાથી છે અને ચેક-આઉટ સવારે 11:00 વાગ્યા સુધી. વહેલું ચેક-ઇન કે મોડું ચેક-આઉટ રૂમની ઉપલબ્ધતા પર આધાર રાખે છે; તમારો સમય જણાવો, અમે પ્રયત્ન કરીશું.',
      'Check-in dopahar 12:00 baje se hai aur check-out subah 11:00 baje tak. Early check-in ya late check-out room availability par depend karta hai; apna time batayein, hum koshish karenge.',
    ),
  },
  {
    key: 'id_needed',
    title: words('ID needed', 'पहचान पत्र', 'ઓળખપત્ર', 'ID chahiye'),
    body: words(
      'Please bring a photo ID for every adult guest: Aadhaar, passport, driving licence or voter ID. Guests from outside India need their passport and visa.',
      'कृपया हर वयस्क मेहमान का फ़ोटो पहचान पत्र लाएँ: आधार, पासपोर्ट, ड्राइविंग लाइसेंस या वोटर आईडी। भारत के बाहर से आए मेहमानों को पासपोर्ट और वीज़ा चाहिए।',
      'દરેક પુખ્ત મહેમાનનું ફોટો ઓળખપત્ર લાવશો: આધાર, પાસપોર્ટ, ડ્રાઇવિંગ લાઇસન્સ કે વોટર આઈડી. ભારત બહારથી આવતા મહેમાનોને પાસપોર્ટ અને વિઝા જોઈએ.',
      'Har adult guest ka photo ID laayein: Aadhaar, passport, driving licence ya voter ID. India ke bahar se aaye guests ko passport aur visa chahiye.',
    ),
  },
  {
    key: 'payment_ways',
    title: words('Ways to pay', 'भुगतान के तरीके', 'ચુકવણીની રીતો', 'Payment ke tareeke'),
    body: words(
      'You can pay by UPI, card, cash or bank transfer. For online payment we will send you a secure payment link.',
      'आप UPI, कार्ड, नकद या बैंक ट्रांसफ़र से भुगतान कर सकते हैं। ऑनलाइन भुगतान के लिए हम आपको सुरक्षित पेमेंट लिंक भेजेंगे।',
      'તમે UPI, કાર્ડ, રોકડ કે બેંક ટ્રાન્સફરથી ચુકવણી કરી શકો છો. ઓનલાઇન ચુકવણી માટે અમે તમને સુરક્ષિત પેમેન્ટ લિંક મોકલીશું.',
      'Aap UPI, card, cash ya bank transfer se payment kar sakte hain. Online payment ke liye hum aapko safe payment link bhejenge.',
    ),
  },
  {
    key: 'room_service',
    title: words('Room service', 'रूम सर्विस', 'રૂમ સર્વિસ', 'Room service'),
    body: words(
      'Room service is open from 7:00 am to 11:00 pm. Reply with what you would like and your room number.',
      'रूम सर्विस सुबह 7:00 से रात 11:00 बजे तक है। आपको क्या चाहिए और अपना कमरा नंबर लिखकर भेजें।',
      'રૂમ સર્વિસ સવારે 7:00 થી રાત્રે 11:00 વાગ્યા સુધી છે. તમને શું જોઈએ છે અને તમારો રૂમ નંબર લખીને મોકલો.',
      'Room service subah 7:00 se raat 11:00 baje tak hai. Aapko kya chahiye aur apna room number likhkar bhejein.',
    ),
  },
  {
    key: 'location',
    title: words('Location', 'लोकेशन', 'લોકેશન', 'Location'),
    body: words('We are sending you our location now. Call or message us here if you need help on the way.', 'हम अभी आपको अपनी लोकेशन भेज रहे हैं। रास्ते में मदद चाहिए तो यहीं कॉल या मैसेज करें।', 'અમે હમણાં તમને અમારું લોકેશન મોકલીએ છીએ. રસ્તામાં મદદ જોઈએ તો અહીં કૉલ કે મેસેજ કરો.', 'Hum abhi aapko apni location bhej rahe hain. Raaste mein madad chahiye toh yahin call ya message karein.'),
  },
  {
    key: 'cab',
    title: words('Cab booking', 'कैब बुकिंग', 'કેબ બુકિંગ', 'Cab booking'),
    body: words('We can book a cab for you. Please tell us the pickup time and where you are going.', 'हम आपके लिए कैब बुक कर सकते हैं। कृपया पिकअप का समय और कहाँ जाना है, बताइए।', 'અમે તમારા માટે કેબ બુક કરી શકીએ છીએ. પિકઅપનો સમય અને ક્યાં જવું છે તે જણાવો.', 'Hum aapke liye cab book kar sakte hain. Pickup ka time aur kahan jaana hai, batayein.'),
  },
];

/** The ready-made quick replies in one language that the team does not have yet (a title is used once, in any case). */
export function missingQuickReplies(language: StarterLanguage, have: readonly { title: string }[]): { title: string; body: string }[] {
  const taken = new Set(have.map((q) => q.title.trim().toLowerCase()));
  return QUICK_REPLY_STARTERS.map((q) => ({ title: q.title[language], body: q.body[language] })).filter((q) => !taken.has(q.title.toLowerCase()));
}

export type StarterDraftButton = { kind: 'url'; text: string; url: string } | { kind: 'quick_reply'; text: string };

export const starterByKey =(key: string | null | undefined): StarterMessage | null => WHATSAPP_STARTERS.find((s) => s.key === key) ?? null;

/** A ready-made message as a hotel's draft in one language. A link button is kept only when the hotel gave its link. */
export function starterDraft(s: StarterMessage, language: StarterLanguage, links: Partial<Record<StarterLink, string>> = {}) {
  return {
    name: s.key,
    language,
    category: s.category,
    body: s.body[language],
    variables: s.variables.map((v, i) => ({ index: i + 1, name: v.name, example: v.example })),
    buttons: s.buttons.flatMap((b): StarterDraftButton[] => {
      if (b.kind === 'quick_reply') return [{ kind: 'quick_reply', text: b.text[language] }];
      const url = b.link ? links[b.link]?.trim() : '';
      return url ? [{ kind: 'url', text: b.text[language], url }] : [];
    }),
    starterKey: s.key,
  };
}

/** The text with the samples in the blanks, as the guest's phone shows it. */
export const starterSample = (s: StarterMessage, language: StarterLanguage): string => s.body[language].replace(/\{\{(\d{1,2})\}\}/g, (m, n: string) => s.variables[Number(n) - 1]?.example ?? m);
