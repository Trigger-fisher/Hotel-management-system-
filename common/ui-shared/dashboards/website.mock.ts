// The in-memory mock of website.ts (dev and local-demo builds only): loaded through ui-shared/mocks (web-app/src/lib/api/mockLoader.ts), never by app code.
import type { MockClock, DashResult, ListQuery, Page } from './common';
import { mockCall, ok, pageOf, mockError } from './common';
import { SITE_URL, URL_RE, addDays, adultsOf, todayIst, validateEnquiry, validatePlan, validateRange, validateRoom, validateSettings, validateSiteDomains, webContentSections, websiteCopy, weekStart, type EnquiryDecision, type FieldErrors, type WebArrival, type WebBlockInput, type WebBlockedRange, type WebBulkRatesInput, type WebCalendarChanges, type WebCalendarWeek, type WebChange, type WebContent, type WebContentKey, type WebDirection, type WebEnquiry, type WebEnquiryInput, type WebEnquiryStats, type WebEnquiryStatus, type WebFileInput, type WebListKind, type WebNearbyInput, type WebNearbyList, type WebNearbyPlace, type WebOccupancy, type WebOverview, type WebPhoto, type WebPlaceLocation, type WebPolicyCard, type WebPolicyInput, type WebRatePlan, type WebRatePlanInput, type WebRoom, type WebRoomInput, type WebRoomRates, type WebService, type WebServiceInput, type WebSettings, type WebSettingsInput, type WebSite, type WebSiteInput } from './website';

interface StoreRoom extends Omit<WebRoom, 'freeToday' | 'plansCount'> {
  sort: number;
}
interface StorePlan extends WebRatePlan {
  sort: number;
}
interface StoreSettings extends Omit<WebSettings, 'smtpPasswordSet' | 'googleMapsApiKeySet' | 'gbpOauthClientSecretSet'> {
  smtpPassword: string;
  googleMapsApiKey: string;
  gbpOauthClientSecret: string;
}

interface Store {
  today: string;
  enquiries: WebEnquiry[];
  rooms: StoreRoom[];
  plans: StorePlan[];
  /** key `${roomId}|${date}` */
  capacity: Map<string, number>;
  blocked: Set<string>;
  /** key `${planId}|${date}|${occ}` */
  dateRates: Map<string, number>;
  photos: WebPhoto[];
  content: WebContent;
  services: WebService[];
  policies: WebPolicyCard[];
  nearby: WebNearbyPlace[];
  settings: StoreSettings;
  changes: WebChange[];
  seq: number;
}

function iso(date: string, hh: number, mm: number): string {
  // IST wall time -> UTC ISO.
  return new Date(Date.parse(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`)).toISOString();
}

function seed(today: string): Store {
  const rooms: StoreRoom[] = [
    { id: 'wr-1', sort: 1, name: 'Deluxe Room', bedType: 'Queen Bed', size: '160 sq.ft', maxGuests: 2, totalCount: 12, badgeLabel: 'Most Booked', note: '', showPrice: true, available: true,
      photos: [{ id: 'rp-1', name: 'deluxe-room-bed', alt: 'Deluxe room with a queen bed and window' }, { id: 'rp-2', name: 'deluxe-room-bath', alt: 'Deluxe room bathroom with shower' }] },
    { id: 'wr-2', sort: 2, name: 'Super Deluxe Room', bedType: 'King Bed', size: '220 sq.ft', maxGuests: 3, totalCount: 8, badgeLabel: 'Best Value', note: '', showPrice: true, available: true,
      photos: [{ id: 'rp-3', name: 'super-deluxe-king-bed', alt: 'Super deluxe room with a king bed' }] },
    { id: 'wr-3', sort: 3, name: 'Executive Suite with Separate Living Area and City View Balcony', bedType: 'King Bed + Sofa Cum Bed', size: '420 sq.ft', maxGuests: 4, totalCount: 2, badgeLabel: 'Premium', note: '', showPrice: false, available: true, photos: [] },
    { id: 'wr-4', sort: 4, name: 'Family Suite', bedType: 'Two Queen Beds', size: '300 sq.ft', maxGuests: 5, totalCount: 3, badgeLabel: '', note: 'Under renovation until March', showPrice: true, available: false, photos: [] },
    // Added: the Standard rooms (110-118) that the corporate and billing mocks bill guests into.
    { id: 'wr-5', sort: 5, name: 'Standard Room', bedType: 'Double Bed', size: '140 sq.ft', maxGuests: 2, totalCount: 8, badgeLabel: 'Budget', note: 'Window faces the inner courtyard', showPrice: true, available: true,
      photos: [{ id: 'rp-4', name: 'standard-room-double-bed', alt: 'Standard room with a double bed and work desk' }, { id: 'rp-5', name: 'standard-room-bath', alt: 'Standard room bathroom with geyser' }] },
  ];

  // Room-only prices equal the corporate rack rates (corporate.ts ROOM_TYPES): Standard 3,200, Deluxe 4,500,
  // Family Suite 7,200, Executive Suite 9,500 a night. Meal plans add breakfast 300, dinner 450, lunch 350 a person.
  // Super Deluxe has no corporate counterpart and sits at 5,800.
  const plans: StorePlan[] = [
    { id: 'wp-1', sort: 1, roomId: 'wr-1', name: 'Room Only', code: 'EP', tiers: [{ guests: 1, pricePaise: 450000 }, { guests: 2, pricePaise: 450000 }], extraPersonPaise: 80000, active: true },
    { id: 'wp-2', sort: 2, roomId: 'wr-1', name: 'With Breakfast', code: 'CP', tiers: [{ guests: 1, pricePaise: 480000 }, { guests: 2, pricePaise: 510000 }], extraPersonPaise: 110000, active: true },
    { id: 'wp-3', sort: 1, roomId: 'wr-2', name: 'Room Only', code: 'EP', tiers: [{ guests: 1, pricePaise: 580000 }, { guests: 2, pricePaise: 580000 }], extraPersonPaise: 90000, active: true },
    { id: 'wp-4', sort: 2, roomId: 'wr-2', name: 'With Breakfast', code: 'CP', tiers: [{ guests: 1, pricePaise: 610000 }, { guests: 2, pricePaise: 640000 }, { guests: 3, pricePaise: 760000 }], extraPersonPaise: null, active: true },
    { id: 'wp-5', sort: 3, roomId: 'wr-2', name: 'All Meals', code: 'AP', tiers: [{ guests: 2, pricePaise: 800000 }], extraPersonPaise: 200000, active: false },
    { id: 'wp-6', sort: 1, roomId: 'wr-3', name: 'With Breakfast', code: 'CP', tiers: [{ guests: 2, pricePaise: 1010000 }], extraPersonPaise: 150000, active: true },
    { id: 'wp-7', sort: 3, roomId: 'wr-1', name: 'Breakfast and Dinner', code: 'MAP', tiers: [{ guests: 1, pricePaise: 525000 }, { guests: 2, pricePaise: 600000 }], extraPersonPaise: 155000, active: true },
    { id: 'wp-8', sort: 2, roomId: 'wr-3', name: 'All Meals', code: 'AP', tiers: [{ guests: 2, pricePaise: 1170000 }, { guests: 3, pricePaise: 1280000 }, { guests: 4, pricePaise: 1390000 }], extraPersonPaise: null, active: true },
    { id: 'wp-9', sort: 1, roomId: 'wr-4', name: 'With Breakfast', code: 'CP', tiers: [{ guests: 3, pricePaise: 810000 }, { guests: 4, pricePaise: 840000 }], extraPersonPaise: 90000, active: false },
    { id: 'wp-10', sort: 1, roomId: 'wr-5', name: 'Room Only', code: 'EP', tiers: [{ guests: 1, pricePaise: 320000 }, { guests: 2, pricePaise: 320000 }], extraPersonPaise: 60000, active: true },
    { id: 'wp-11', sort: 2, roomId: 'wr-5', name: 'With Breakfast', code: 'CP', tiers: [{ guests: 1, pricePaise: 350000 }, { guests: 2, pricePaise: 380000 }], extraPersonPaise: 90000, active: true },
    { id: 'wp-12', sort: 3, roomId: 'wr-5', name: 'Corporate Rate', code: 'CORP', tiers: [{ guests: 1, pricePaise: 320000 }], extraPersonPaise: null, active: true },
  ];

  const d = (n: number) => addDays(today, n);
  type E = [string, string, string | null, string | null, string | null, number, number, number, number, string, WebEnquiryStatus, number, string | null];
  // name, phone, email, roomId, (checkIn offset), nights, adults, children, createdOffsetDays, message, status, createdHour, note
  const raw: E[] = [
    ['Rajesh Patel', '9825012345', 'rajesh.patel@gmail.com', 'wr-1', '0', 2, 2, 0, -3, 'Arriving by the evening train, around 7 pm. Need an early tea please.', 'confirmed', 11, null],
    ['Priya Sharma', '9898123456', 'priya.sharma@outlook.com', 'wr-2', '0', 1, 2, 1, -5, 'Family function at Kalavad Road. Need an extra mattress for my daughter.', 'confirmed', 16, null],
    ['Venkatanarasimharajuvaripeta Kumaraswamy', '9440098765', 'kumaraswamy.v@yahoo.co.in', 'wr-3', '2', 3, 2, 2, -1, 'Coming for a wedding with my parents. Please give a room on a lower floor, my father cannot climb stairs.', 'confirmed', 9, null],
    ['Anjali Mehta', '9727345678', null, 'wr-1', '4', 1, 1, 0, -2, 'Business trip. Will need an invoice with GST 24ABCDE1234F1Z5.', 'confirmed', 14, null],
    ['Suresh Iyer', '9840011223', 'suresh.iyer@tcs.com', null, '6', 2, 1, 0, 0, 'Is there parking for a car?', 'pending', 10, null],
    ['Fatima Shaikh', '9998877665', 'fatima.s@gmail.com', 'wr-2', '9', 4, 2, 0, 0, 'Do you have airport pickup? Our flight lands at 6:40 am.', 'pending', 8, null],
    ['Harshad Joshi', '9824456789', null, 'wr-1', '12', 1, 2, 0, -1, 'Please call before confirming.', 'pending', 18, null],
    ['Meera Nair', '9947012345', 'meera.nair@gmail.com', 'wr-4', '15', 2, 3, 2, -1, 'Need two rooms side by side if possible.', 'pending', 20, null],
    ['Amit Desai', '9909090909', 'amit.desai@infosys.com', 'wr-2', '-2', 2, 2, 0, -9, 'Corporate stay, company will pay at checkout.', 'confirmed', 12, null],
    ['Kavita Reddy', '9866554433', 'kavita.reddy@gmail.com', 'wr-1', '3', 2, 2, 0, -6, 'Plans changed, sorry.', 'declined', 15, 'Guest called to cancel; travel plans changed.'],
    ['Mohammed Irfan', '9712345670', null, 'wr-3', '20', 3, 2, 0, -4, 'Honeymoon stay. Any decoration possible?', 'declined', 13, 'Suite is booked for a wedding party on those dates.'],
    ['Neha Gupta', '9811122233', 'neha.gupta@hotmail.com', 'wr-2', '25', 2, 2, 1, -2, 'Is breakfast included?', 'pending', 9, null],
    ['Rohan Kapoor', '9820098200', 'rohan.k@gmail.com', 'wr-1', '1', 1, 1, 0, -12, 'Late check-in around midnight.', 'confirmed', 22, null],
    ['Lakshmi Venkatesh', '9444455566', 'lakshmi.v@gmail.com', null, '30', 5, 2, 0, -1, 'Long stay for medical treatment at the civil hospital. Any discount for 5 nights?', 'pending', 17, null],
    ['Deepak Chauhan', '9714412345', null, 'wr-2', '-20', 2, 2, 0, -30, 'Exam centre is nearby.', 'confirmed', 10, null],
    ['Sneha Kulkarni', '9822012345', 'sneha.k@gmail.com', 'wr-1', '-40', 1, 2, 0, -50, 'Need a quiet room.', 'declined', 11, 'No reply from the guest after two calls.'],
    ['Gurpreet Singh', '9815566778', 'gurpreet.singh@gmail.com', 'wr-2', '45', 3, 4, 0, -3, 'Group of four friends.', 'pending', 19, null],
    ['Bhavna Trivedi', '9879012345', 'bhavna.trivedi@gmail.com', 'wr-1', '5', 2, 2, 1, -2, 'Celebrating our anniversary.', 'confirmed', 21, null],
    // Added: the same people as the guest portal (guest.ts), company portal (corporate.ts), Companies leads and Billing (billing.ts).
    ['Amit Joshi', '9876543210', 'amit.joshi@example.com', 'wr-1', '-7', 3, 2, 0, -13, 'Coming from Ahmedabad for work, 2 of us. Room 204 again if it is free, please.', 'confirmed', 10, null],
    ['Deepa Iyer', '9824012399', 'deepa.iyer@tcs.com', 'wr-5', '14', 4, 3, 0, -1, 'TCS audit team of three, separate rooms. Bill to Tata Consultancy Services on account, as usual.', 'pending', 11, null],
    ['Rohan Mehta', '9812345670', null, 'wr-1', '3', 2, 1, 0, -2, 'TCS booking through Deepa Iyer. Breakfast needed by 7:30 am.', 'confirmed', 15, null],
    ['Bhavin Thakkar', '9824456789', 'bhavin.thakkar@jyoti.co.in', 'wr-1', '-4', 1, 1, 0, -6, 'Jyoti CNC visit, Metoda GIDC. Advance paid by card at the desk.', 'confirmed', 12, null],
    ['Hetal Parmar', '8866012345', 'hetal.parmar@gmail.com', 'wr-2', '1', 2, 2, 0, -3, 'Advance paid by UPI. Please keep a room away from the lift.', 'confirmed', 17, null],
    ['Bhavesh Kotak', '9825011223', null, 'wr-1', '33', 2, 6, 2, -6, 'Three deluxe rooms for a family function on Kalavad Road.', 'pending', 16, null],
    ['Jayesh Solanki', '7990123456', null, 'wr-2', '6', 2, 6, 0, -5, 'Group of 6 for a Dwarka-Somnath tour, staying here on the way.', 'declined', 14, 'Group tour postponed; the cash advance was refunded in full.'],
    ['Kavita Nair', '9846012345', 'kavita.nair@tcs.com', 'wr-5', '19', 2, 1, 0, 0, 'Same standard room as last time if possible (115).', 'pending', 9, null],
    ['Farhan Qureshi', '9898765432', null, 'wr-5', '-5', 1, 1, 0, -5, 'Late arrival, around 11 pm. Will pay a small advance in cash.', 'confirmed', 19, null],
    ['Kinjal Dave', '8780012345', 'kinjal.dave@yahoo.com', 'wr-2', '-3', 1, 2, 0, -8, 'Coming from Bhavnagar for a wedding.', 'confirmed', 13, null],
  ];
  const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? null;
  const enquiries: WebEnquiry[] = raw.map((r, i) => {
    const [name, phone, email, roomId, inOff, nights, adults, children, created, message, status, hour, note] = r;
    const checkIn = d(Number(inOff));
    const createdDate = d(created);
    const createdAt = iso(createdDate, hour, (i * 7) % 60);
    const decided = status !== 'pending';
    return {
      id: `we-${i + 1}`,
      reference: `ENQ-${createdDate.slice(2, 4)}${createdDate.slice(5, 7)}-${String(40 + i).padStart(4, '0')}`,
      name, phone, email, roomId, roomName: roomName(roomId),
      checkIn, checkOut: addDays(checkIn, nights), guests: adults + children, children, message, status, createdAt,
      ipAddress: i % 3 === 0 ? `103.21.${40 + i}.${100 + i}` : null,
      decidedAt: decided ? iso(addDays(createdDate, 0), Math.min(hour + 2, 23), 15) : null,
      decidedByName: decided ? (i % 2 ? 'Nikhil Shah' : 'Mihir Jungiwala') : null,
      decisionNote: note,
    };
  });
  enquiries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const blocked = new Set<string>();
  for (let i = 3; i <= 5; i += 1) blocked.add(`wr-4|${d(i)}`);
  blocked.add(`wr-3|${d(10)}`);
  blocked.add(`wr-3|${d(11)}`);
  // Added: Super Deluxe floor held for a wedding party, one Standard room night for deep cleaning.
  for (let i = 17; i <= 19; i += 1) blocked.add(`wr-2|${d(i)}`);
  blocked.add(`wr-5|${d(7)}`);
  blocked.add(`wr-1|${d(26)}`);

  const capacity = new Map<string, number>();
  capacity.set(`wr-1|${d(1)}`, 10);
  capacity.set(`wr-2|${d(2)}`, 6);
  capacity.set(`wr-5|${d(0)}`, 7);
  capacity.set(`wr-5|${d(14)}`, 5);
  capacity.set(`wr-1|${d(8)}`, 11);

  const dateRates = new Map<string, number>();
  for (let i = 4; i <= 6; i += 1) {
    dateRates.set(`wp-1|${d(i)}|double`, 490000);
    dateRates.set(`wp-2|${d(i)}|double`, 560000);
  }
  // Added: weekend and festival prices.
  for (let i = 20; i <= 22; i += 1) {
    dateRates.set(`wp-3|${d(i)}|double`, 620000);
    dateRates.set(`wp-4|${d(i)}|double`, 690000);
    dateRates.set(`wp-4|${d(i)}|single`, 650000);
  }
  dateRates.set(`wp-10|${d(1)}|single`, 290000);
  dateRates.set(`wp-10|${d(2)}|single`, 290000);
  dateRates.set(`wp-11|${d(5)}|double`, 410000);
  dateRates.set(`wp-6|${d(10)}|double`, 1090000);

  const captions: [string, string][] = [
    ['Hotel entrance at night', 'Front of Hotel Sunrise lit up at night'],
    ['Reception', 'Reception desk with two staff members'],
    ['Deluxe room', 'Deluxe room with a queen bed'],
    ['Super deluxe room', 'Super deluxe room with a king bed and sofa'],
    ['Restaurant', 'Pure veg restaurant with family seating'],
    ['Banquet hall', 'Banquet hall set up for a wedding reception'],
    ['', ''],
    ['Rooftop view of Rajkot', ''],
    ['Breakfast spread', 'Gujarati breakfast thali with dhokla and thepla'],
    ['Executive suite living area', 'Suite living room with sofa and city view'],
    ['Standard room', 'Standard room with a double bed and work desk'],
    ['Lobby', 'Lobby seating with sofas and a coffee table'],
    ['Navratri at Hotel Sunrise', 'Entrance decorated with diyas and marigold for Navratri'],
    ['Conference room', 'Conference room set up for a corporate meeting of 20'],
    ['Family suite', 'Family suite with two queen beds'],
    ['Parking', 'Covered parking for cars and two-wheelers'],
  ];
  const photos: WebPhoto[] = captions.map(([caption, altText], i) => ({ id: `wg-${i + 1}`, caption, altText, shade: i % 6 }));

  const content: WebContent = {
    heroTitleLine1: 'Your home in Rajkot,',
    heroTitleEmphasis: 'looked after properly',
    heroLead: 'Twenty years of looking after our guests, in comfortable Deluxe and Super Deluxe rooms with everything you need and a team that remembers your name.',
    quickCheckTitle: 'Check availability',
    qcMsgPickDates: 'Pick your check-in and check-out dates first.',
    qcMsgAvailable: 'Good news: rooms are available for your dates.',
    qcMsgUnavailable: 'Sorry, we are full for those dates. Call reception and we will try to help.',
    qcMsgError: 'We could not check right now. Please try again or call reception.',
    aboutKicker: 'Our story',
    aboutHeading: 'A family-run hotel since 2005',
    aboutP1: 'Hotel Sunrise opened in 2005 with a simple idea: treat every guest the way you would treat someone visiting your own home.',
    aboutP2: 'We are still run by the same family. The rooms have been renovated and the Wi-Fi made faster, but the front desk still knows regular guests by name.',
    aboutP3: 'Whether you are here for one night between trains or a week for a family function, you will be looked after properly.',
    enquireHeading: 'Send us an enquiry',
    enquireLead: 'Fill this in and our team will call you back, usually within the hour during working hours.',
    enquirePoints: ['No advance payment needed', 'Best available rate, direct with us', 'Cancellation terms confirmed before you commit', 'Give your email and we will confirm in writing'],
    bookingTermsText: 'An enquiry is not a booking until we confirm it. Government ID is required at check-in for every guest.',
    fmMsgName: 'Please enter your full name.',
    fmMsgPhone: 'Please enter a valid 10-digit mobile number.',
    fmMsgEmail: 'Please enter a valid email address.',
    fmMsgCheckin: 'Please pick a check-in date.',
    fmMsgCheckout: 'Please pick a check-out date.',
    fmMsgRoom: 'Please choose a room.',
    fmMsgAdults: 'Please tell us how many adults.',
    fmMsgChildren: 'Please tell us how many children.',
    fmMsgMessage: 'Please tell us anything we should know.',
    fmMsgTerms: 'Please accept the Terms & Conditions.',
    fmMsgSuccess: 'Thank you. Your enquiry {{reference}} has reached us; we will call you shortly.',
    policiesFooterNote: 'Questions about these rules? Call our General Manager on {{gm_phone}}.',
    footerTagline: 'Comfortable rooms, honest rates and a team that actually cares.',
  };

  const services: WebService[] = [
    { id: 'ws-1', title: 'Free Wi-Fi', description: 'Fast Wi-Fi in every room and the lobby.', hasIcon: true },
    { id: 'ws-2', title: 'Free parking', description: 'Covered parking for cars and two-wheelers.', hasIcon: true },
    { id: 'ws-3', title: 'Pure veg restaurant', description: 'Gujarati, Punjabi and South Indian food, 7 am to 11 pm.', hasIcon: true },
    { id: 'ws-4', title: '24-hour reception', description: '', hasIcon: false },
    { id: 'ws-5', title: 'Banquet hall for weddings, birthday parties and corporate events up to 250 guests', description: 'Ask reception for packages.', hasIcon: true },
    { id: 'ws-6', title: 'Laundry', description: 'Same-day laundry if given before 10 am.', hasIcon: false },
    { id: 'ws-7', title: 'Conference room', description: 'Seats 20, with projector and Wi-Fi. Corporate guests can book it through their travel desk.', hasIcon: true },
    { id: 'ws-8', title: 'Airport and station pick-up', description: 'Hirasar airport and Rajkot Junction, on request. Tell us your train or flight.', hasIcon: true },
    { id: 'ws-9', title: 'Room service', description: 'From our pure veg kitchen, 7 am to 11 pm.', hasIcon: false },
    { id: 'ws-10', title: 'Doctor on call', description: 'A local doctor can visit the hotel at any hour.', hasIcon: false },
  ];

  const policies: WebPolicyCard[] = [
    { id: 'wpol-1', title: 'Check-in and check-out', lines: ['Check-in is from 12:00 pm', 'Check-out is by 11:00 am', 'Early check-in depends on availability'], hasIcon: true },
    { id: 'wpol-2', title: 'Cancellation', lines: ['Free cancellation up to 24 hours before check-in', 'Later cancellations are charged one night', 'No-shows are charged one night'], hasIcon: true },
    { id: 'wpol-3', title: 'Guest rules', lines: ['Government ID is required for every guest', 'Unmarried couples are welcome with valid ID', 'No smoking inside rooms', 'Pets are not allowed', 'Visitors are allowed in the lobby only', 'Quiet hours from 10 pm to 7 am'], hasIcon: false },
    { id: 'wpol-4', title: 'Children and extra beds', lines: ['Children under 6 stay free using existing beds', 'An extra bed is ₹600 a night', 'Family Suite sleeps up to 5'], hasIcon: true },
    { id: 'wpol-5', title: 'Payment', lines: ['We accept cash, UPI, cards and bank transfer', 'Companies with an account are billed on credit', 'GST invoice on request, give your GSTIN at check-in'], hasIcon: true },
    { id: 'wpol-6', title: 'Meal plans', lines: ['CP: breakfast', 'MAP: breakfast and one meal', 'AP: all meals', 'Pure veg food only'], hasIcon: false },
  ];

  const nearby: WebNearbyPlace[] = [
    { id: 'wn-1', title: 'Rajkot International Airport (Hirasar)', distanceLabel: '32 km', mapUrl: 'https://maps.app.goo.gl/hirasarAirport', mapQuery: '', location: 'exact' },
    { id: 'wn-2', title: 'Rajkot Junction Railway Station', distanceLabel: '4.5 km', mapUrl: 'https://maps.app.goo.gl/rajkotJn', mapQuery: '', location: 'link' },
    { id: 'wn-3', title: 'Rajkot ST Bus Stand', distanceLabel: '3.2 km', mapUrl: '', mapQuery: 'Rajkot ST bus stand', location: 'name' },
    { id: 'wn-4', title: 'Race Course Ground', distanceLabel: '2 km', mapUrl: '', mapQuery: 'Race Course Rajkot', location: 'name' },
    { id: 'wn-5', title: 'Crystal Mall, Kalawad Road', distanceLabel: '1.2 km', mapUrl: '', mapQuery: 'Crystal Mall Kalawad Road Rajkot', location: 'name' },
    { id: 'wn-6', title: 'Kaba Gandhi no Delo', distanceLabel: '3.8 km', mapUrl: 'https://maps.app.goo.gl/kabaGandhiNoDelo', mapQuery: '', location: 'link' },
    { id: 'wn-7', title: 'Watson Museum, Jubilee Garden', distanceLabel: '3.5 km', mapUrl: '', mapQuery: 'Watson Museum Rajkot', location: 'name' },
    { id: 'wn-8', title: 'PDU Civil Hospital', distanceLabel: '4 km', mapUrl: '', mapQuery: 'PDU Civil Hospital Rajkot', location: 'name' },
    { id: 'wn-9', title: 'Niranjan Shah Cricket Stadium, Khandheri', distanceLabel: '18 km', mapUrl: 'https://maps.app.goo.gl/scaStadiumKhandheri', mapQuery: '', location: 'exact' },
    { id: 'wn-10', title: 'Metoda GIDC', distanceLabel: '19 km', mapUrl: '', mapQuery: 'Metoda GIDC Rajkot', location: 'name' },
  ];

  const settings: StoreSettings = {
    gmPhone: '9825735404',
    receptionPhone: '02812345678',
    email: 'stay@hotelsunriserajkot.in',
    openedYear: 2005,
    address: 'Sunrise Complex, KKV Chowk, Kalavad Road, Rajkot, Gujarat 360005',
    checkinTime: '12:00 pm',
    checkoutTime: '11:00 am',
    mapLat: 22.2913,
    mapLng: 70.7768,
    metaTitle: 'Hotel Sunrise, Rajkot | Comfortable rooms on Kalavad Road',
    metaDescription: 'Family-run hotel on Kalavad Road, Rajkot. Deluxe and Super Deluxe rooms, pure veg restaurant, free parking.',
    metaKeywords: 'hotel in rajkot, kalavad road hotel, rajkot rooms',
    gbpLink: 'https://g.page/hotel-sunrise-rajkot',
    facebookLink: 'https://facebook.com/hotelsunriserajkot',
    instagramLink: '',
    hasLogo: true,
    hasFavicon: false,
    recipients: [{ name: 'Mihir Jungiwala', email: 'gm@hotelsunriserajkot.in' }, { name: 'Front Desk', email: 'reception@hotelsunriserajkot.in' }],
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpUsername: 'stay@hotelsunriserajkot.in',
    smtpPassword: 'abcd efgh ijkl mnop',
    smtpFromEmail: 'stay@hotelsunriserajkot.in',
    smtpFromName: 'Hotel Sunrise',
    googleMapsApiKey: 'AIzaSyD4mockKeyForHotelSunrise3kQw',
    googlePlaceId: 'ChIJmock-sunrise-rajkot',
    googleMinReviewRating: 4,
    gbpOauthClientId: '123456789-sunrise.apps.googleusercontent.com',
    gbpOauthClientSecret: 'GOCSPX-mockSecret9f2a',
    gbpRedirectUrl: `${SITE_URL}/admin/website/google/callback`,
    googleStatus: 'ready',
    googleLastFetchedAt: null,
    googleReviewCount: 5,
  };

  const changes: WebChange[] = [
    { id: 'wc-1', summary: 'Confirmed enquiry from Anjali Mehta', userName: 'Mihir Jungiwala', at: iso(d(-2), 15, 10) },
    { id: 'wc-2', summary: 'Blocked Family Suite for 3 dates', userName: 'Mihir Jungiwala', at: iso(d(-2), 11, 40) },
    { id: 'wc-3', summary: 'Changed the hero banner wording', userName: 'Nikhil Shah', at: iso(d(-3), 18, 5) },
    { id: 'wc-4', summary: 'Added 2 gallery photos', userName: null, at: iso(d(-5), 9, 30) },
    { id: 'wc-5', summary: 'Added the Standard Room category', userName: 'Mihir Jungiwala', at: iso(d(-6), 12, 20) },
    { id: 'wc-6', summary: 'Confirmed enquiry from Bhavin Thakkar', userName: 'Nikhil Shah', at: iso(d(-6), 14, 15) },
    { id: 'wc-7', summary: 'Set festival prices for Super Deluxe Room', userName: 'Mihir Jungiwala', at: iso(d(-7), 17, 45) },
    { id: 'wc-8', summary: 'Cancelled enquiry from Jayesh Solanki', userName: 'Mihir Jungiwala', at: iso(d(-5), 16, 15) },
  ];

  return { today, enquiries, rooms, plans, capacity, blocked, dateRates, photos, content, services, policies, nearby, settings, changes, seq: 100 };
}

// ---------------------------------------------------------------- api

/** Indian financial year (Apr-Mar) start year for a date. */
function fyOf(date: string): number {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? y : y - 1;
}

function moveItem<T extends { id: string }>(list: T[], id: string, dir: WebDirection): boolean {
  const i = list.findIndex((x) => x.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return false;
  const a = list[i];
  const b = list[j];
  if (!a || !b) return false;
  list[i] = b;
  list[j] = a;
  return true;
}

/** Whether a card keeps an icon after a save: a new file wins, else "Remove this icon" clears it. */
function iconAfter(had: boolean, input: { icon?: WebFileInput; removeIcon?: boolean }): boolean {
  if (input.icon) return true;
  return input.removeIcon ? false : had;
}

function invalid(fields: FieldErrors): DashResult<never> | null {
  return Object.keys(fields).length ? mockError('VALIDATION_FAILED', fields) : null;
}

export function createWebsiteApi(clock: MockClock = {}) {
  const s = seed(todayIst());
  const call = <T>(fn: () => DashResult<T>) => mockCall(fn, clock);
  const nextId = (p: string) => `${p}-${++s.seq}`;
  // decision 55: the website switch and its addresses (the mock treats SITE_TAKEN as used by another hotel)
  const SITE_TAKEN = 'www.thepearl.example';
  const site: { live: boolean; domains: string[] } = { live: false, domains: [] };
  const siteNow = (): WebSite => ({ live: site.live, domains: [...site.domains], slug: 'hotel-sunrise', signInUrl: 'https://www.easyhotelsolutions.in/?hotel=hotel-sunrise' });
  const log = (summary: string) => {
    s.changes.unshift({ id: nextId('wc'), summary, userName: 'You', at: new Date().toISOString() });
  };

  // Nights held by confirmed stays: check-in up to, not including, check-out.
  const soldOn = (roomId: string, date: string) =>
    s.enquiries.filter((e) => e.status === 'confirmed' && e.roomId === roomId && e.checkIn <= date && date < e.checkOut).length;
  const capOn = (r: StoreRoom, date: string) => s.capacity.get(`${r.id}|${date}`) ?? r.totalCount;
  const isBlocked = (roomId: string, date: string) => s.blocked.has(`${roomId}|${date}`);
  const sortedRooms = () => [...s.rooms].sort((a, b) => a.sort - b.sort);
  const plansOf = (roomId: string) => s.plans.filter((p) => p.roomId === roomId).sort((a, b) => a.sort - b.sort);

  const toRoom = (r: StoreRoom): WebRoom => {
    const { sort: _sort, ...rest } = r;
    void _sort;
    const free = isBlocked(r.id, s.today) ? 0 : Math.max(0, capOn(r, s.today) - soldOn(r.id, s.today));
    return { ...rest, photos: rest.photos.map((p) => ({ ...p })), freeToday: free, plansCount: plansOf(r.id).length };
  };

  const basePrice = (p: WebRatePlan, occ: WebOccupancy): number | null => {
    const n = occ === 'single' ? 1 : 2;
    return p.tiers.find((t) => t.guests === n)?.pricePaise ?? null;
  };

  const blockedRanges = (): WebBlockedRange[] => {
    const from = addDays(s.today, -1);
    const out: WebBlockedRange[] = [];
    for (const r of sortedRooms()) {
      const dates = [...s.blocked].filter((k) => k.startsWith(`${r.id}|`)).map((k) => k.split('|')[1] ?? '').filter((x) => x >= from).sort();
      let cur: WebBlockedRange | null = null;
      for (const dt of dates) {
        if (cur && addDays(cur.end, 1) === dt) {
          cur.end = dt;
          cur.nights += 1;
        } else {
          if (cur) out.push(cur);
          cur = { roomId: r.id, roomName: r.name, start: dt, end: dt, nights: 1 };
        }
      }
      if (cur) out.push(cur);
    }
    return out;
  };

  const statsOf = (list: WebEnquiry[]): WebEnquiryStats => ({
    all: list.length,
    pending: list.filter((e) => e.status === 'pending').length,
    confirmed: list.filter((e) => e.status === 'confirmed').length,
    declined: list.filter((e) => e.status === 'declined').length,
  });

  const toArrival = (e: WebEnquiry): WebArrival => ({
    id: e.id, reference: e.reference, name: e.name, phone: e.phone, roomName: e.roomName,
    guests: adultsOf(e), children: e.children, checkIn: e.checkIn, message: e.message,
  });

  const findEnquiry = (id: string) => s.enquiries.find((e) => e.id === id);

  const enquiryFromInput = (i: WebEnquiryInput) => ({
    name: i.name.trim(), phone: i.phone.trim(), email: i.email.trim() || null,
    roomId: i.roomId, roomName: s.rooms.find((r) => r.id === i.roomId)?.name ?? null,
    checkIn: i.checkIn, checkOut: i.checkOut, guests: i.guests + i.children, children: i.children, message: i.message.trim(),
  });

  const publicSettings = (): WebSettings => {
    const { smtpPassword, googleMapsApiKey, gbpOauthClientSecret, ...rest } = s.settings;
    return {
      ...rest,
      recipients: rest.recipients.map((r) => ({ ...r })),
      smtpPasswordSet: smtpPassword.length > 0,
      googleMapsApiKeySet: googleMapsApiKey.length > 0,
      gbpOauthClientSecretSet: gbpOauthClientSecret.length > 0,
    };
  };

  return {
    // ------------------------------------------------ overview
    getOverview: (fy?: number) =>
      call<WebOverview>(() => {
        const currentFy = fyOf(s.today);
        const year = fy ?? currentFy;
        const inYear = s.enquiries.filter((e) => fyOf(todayIst(new Date(e.createdAt))) === year);
        const weekEnd = addDays(s.today, 7);
        const confirmed = s.enquiries.filter((e) => e.status === 'confirmed').sort((a, b) => a.checkIn.localeCompare(b.checkIn));
        return ok({
          siteUrl: SITE_URL,
          fy: year,
          currentFy,
          years: [currentFy, currentFy - 1, currentFy - 2],
          stats: statsOf(inYear),
          arrivingToday: confirmed.filter((e) => e.checkIn === s.today).map(toArrival),
          arrivingWeek: confirmed.filter((e) => e.checkIn > s.today && e.checkIn <= weekEnd).map(toArrival),
          recent: inYear.slice(0, 6).map((e) => ({ ...e })),
          blocked: blockedRanges(),
          changes: s.changes.slice(0, 6).map((c) => ({ ...c })),
          facts: { rooms: s.rooms.length, photos: s.photos.length },
        });
      }),

    // ------------------------------------------------ enquiries
    listEnquiries: (q: ListQuery = {}) =>
      call<{ page: Page<WebEnquiry>; stats: WebEnquiryStats }>(() => {
        const tab = q.tab && q.tab !== 'all' ? q.tab : null;
        const s1 = (q.search ?? '').trim().toLowerCase();
        const digits = s1.replace(/\D/g, '');
        const searched = s1
          ? s.enquiries.filter((e) => [e.name, e.phone, e.email ?? '', e.reference].some((v) => v.toLowerCase().includes(s1)) || (digits.length >= 3 && e.phone.includes(digits)))
          : s.enquiries;
        const filtered = tab ? searched.filter((e) => e.status === tab) : searched;
        const page = pageOf(filtered, { ...q, search: '' }, () => true);
        return ok({ page: { ...page, items: page.items.map((e) => ({ ...e })) }, stats: statsOf(searched) });
      }),
    getEnquiry: (id: string) =>
      call<WebEnquiry>(() => {
        const e = findEnquiry(id);
        return e ? ok({ ...e }) : mockError('NOT_FOUND');
      }),
    updateEnquiry: (id: string, input: WebEnquiryInput) =>
      call<WebEnquiry>(() => {
        const e = findEnquiry(id);
        if (!e) return mockError('NOT_FOUND');
        const bad = invalid(validateEnquiry(input));
        if (bad) return bad;
        Object.assign(e, enquiryFromInput(input));
        log(`Edited enquiry ${e.reference}`);
        return ok({ ...e });
      }),
    confirmEnquiry: (id: string) =>
      call<EnquiryDecision>(() => {
        const e = findEnquiry(id);
        if (!e) return mockError('NOT_FOUND');
        if (e.status !== 'pending') return mockError('CONFLICT');
        Object.assign(e, { status: 'confirmed', decidedAt: new Date().toISOString(), decidedByName: 'You', decisionNote: null });
        log(`Confirmed enquiry from ${e.name}`);
        return ok({ enquiry: { ...e }, message: `Enquiry ${e.reference} confirmed.` });
      }),
    declineEnquiry: (id: string, reason: string) =>
      call<EnquiryDecision>(() => {
        const e = findEnquiry(id);
        if (!e) return mockError('NOT_FOUND');
        if (!reason.trim()) return mockError('VALIDATION_FAILED', { reason: websiteCopy.enquiries.reasonMissing });
        if (e.status === 'declined') return mockError('CONFLICT');
        Object.assign(e, { status: 'declined', decidedAt: new Date().toISOString(), decidedByName: 'You', decisionNote: reason.trim().slice(0, 255) });
        log(`Cancelled enquiry ${e.reference}`);
        return ok({ enquiry: { ...e }, message: `Enquiry ${e.reference} cancelled.` });
      }),
    deleteEnquiry: (id: string) =>
      call<{ id: string }>(() => {
        const i = s.enquiries.findIndex((e) => e.id === id);
        if (i < 0) return mockError('NOT_FOUND');
        const [gone] = s.enquiries.splice(i, 1);
        log(`Deleted enquiry ${gone?.reference ?? ''}`);
        return ok({ id });
      }),

    // ------------------------------------------------ rooms
    listRooms: () => call<WebRoom[]>(() => ok(sortedRooms().map(toRoom))),
    getRoom: (id: string) =>
      call<WebRoom>(() => {
        const r = s.rooms.find((x) => x.id === id);
        return r ? ok(toRoom(r)) : mockError('NOT_FOUND');
      }),
    createRoom: (input: WebRoomInput) =>
      call<WebRoom>(() => {
        const bad = invalid(validateRoom(input));
        if (bad) return bad;
        const r: StoreRoom = { ...input, name: input.name.trim(), id: nextId('wr'), sort: Math.max(0, ...s.rooms.map((x) => x.sort)) + 1, photos: input.photos.map((p) => ({ ...p })) };
        s.rooms.push(r);
        log(`Added room category ${r.name}`);
        return ok(toRoom(r));
      }),
    updateRoom: (id: string, input: WebRoomInput) =>
      call<WebRoom>(() => {
        const r = s.rooms.find((x) => x.id === id);
        if (!r) return mockError('NOT_FOUND');
        const bad = invalid(validateRoom(input));
        if (bad) return bad;
        Object.assign(r, { ...input, name: input.name.trim(), photos: input.photos.map((p) => ({ ...p })) });
        s.enquiries.forEach((e) => { if (e.roomId === id) e.roomName = r.name; });
        log(`Edited room category ${r.name}`);
        return ok(toRoom(r));
      }),
    deleteRoom: (id: string) =>
      call<{ id: string }>(() => {
        const i = s.rooms.findIndex((x) => x.id === id);
        if (i < 0) return mockError('NOT_FOUND');
        const [gone] = s.rooms.splice(i, 1);
        s.plans = s.plans.filter((p) => p.roomId !== id);
        log(`Deleted room category ${gone?.name ?? ''}`);
        return ok({ id });
      }),
    moveRoom: (id: string, { direction: dir }: { direction: WebDirection }) =>
      call<WebRoom[]>(() => {
        const list = sortedRooms();
        if (!moveItem(list, id, dir)) return mockError('CONFLICT');
        list.forEach((r, i) => { r.sort = i + 1; });
        return ok(list.map(toRoom));
      }),

    // ------------------------------------------------ rates
    listRates: () =>
      call<WebRoomRates[]>(() =>
        ok(sortedRooms().map((r) => {
          const plans = plansOf(r.id);
          const tonight = plans.filter((p) => p.active).map((p) => s.dateRates.get(`${p.id}|${s.today}|double`) ?? basePrice(p, 'double') ?? basePrice(p, 'single') ?? p.tiers[0]?.pricePaise ?? 0);
          return {
            room: toRoom(r),
            tonightPaise: tonight.length ? Math.min(...tonight) : 0,
            plans: plans.map(({ sort: _s, ...p }) => { void _s; return { ...p, tiers: p.tiers.map((t) => ({ ...t })) }; }),
          };
        })),
      ),
    createPlan: (roomId: string, input: WebRatePlanInput) =>
      call<WebRatePlan>(() => {
        if (!s.rooms.some((r) => r.id === roomId)) return mockError('NOT_FOUND');
        const bad = invalid(validatePlan(input));
        if (bad) return bad;
        const p: StorePlan = {
          id: nextId('wp'), roomId, sort: plansOf(roomId).length + 1, active: true,
          name: input.name.trim(), code: input.code.trim().toUpperCase(),
          tiers: [...input.tiers].sort((a, b) => a.guests - b.guests), extraPersonPaise: input.extraPersonPaise,
        };
        s.plans.push(p);
        log(`Added tariff plan ${p.name}`);
        return ok({ ...p });
      }),
    updatePlan: (id: string, input: WebRatePlanInput) =>
      call<WebRatePlan>(() => {
        const p = s.plans.find((x) => x.id === id);
        if (!p) return mockError('NOT_FOUND');
        const bad = invalid(validatePlan(input));
        if (bad) return bad;
        Object.assign(p, { name: input.name.trim(), code: input.code.trim().toUpperCase(), tiers: [...input.tiers].sort((a, b) => a.guests - b.guests), extraPersonPaise: input.extraPersonPaise });
        log(`Edited tariff plan ${p.name}`);
        return ok({ ...p });
      }),
    togglePlan: (id: string) =>
      call<WebRatePlan>(() => {
        const p = s.plans.find((x) => x.id === id);
        if (!p) return mockError('NOT_FOUND');
        p.active = !p.active;
        log(`${p.active ? 'Activated' : 'Paused'} tariff plan ${p.name}`);
        return ok({ ...p });
      }),
    deletePlan: (id: string) =>
      call<{ id: string }>(() => {
        const p = s.plans.find((x) => x.id === id);
        if (!p) return mockError('NOT_FOUND');
        s.plans = s.plans.filter((x) => x.id !== id);
        for (const k of [...s.dateRates.keys()]) if (k.startsWith(`${id}|`)) s.dateRates.delete(k);
        log(`Deleted tariff plan ${p.name}`);
        return ok({ id });
      }),
    movePlan: (id: string, { direction: dir }: { direction: WebDirection }) =>
      call<{ id: string }>(() => {
        const p = s.plans.find((x) => x.id === id);
        if (!p) return mockError('NOT_FOUND');
        const list = plansOf(p.roomId);
        if (!moveItem(list, id, dir)) return mockError('CONFLICT');
        list.forEach((x, i) => { x.sort = i + 1; });
        return ok({ id });
      }),

    // ------------------------------------------------ calendar
    getCalendar: (start?: string) =>
      call<WebCalendarWeek>(() => {
        const first = start ?? weekStart(s.today);
        const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
        return ok({
          days,
          prevStart: addDays(first, -7),
          nextStart: addDays(first, 7),
          today: s.today,
          rooms: sortedRooms().map((r) => ({
            roomId: r.id,
            roomName: r.name,
            totalCount: r.totalCount,
            cells: days.map((date) => ({ date, capacity: capOn(r, date), sold: soldOn(r.id, date), blocked: isBlocked(r.id, date) })),
            plans: plansOf(r.id).map((p) => ({
              planId: p.id, code: p.code, name: p.name,
              rows: (['single', 'double'] as const)
                .filter((occ) => basePrice(p, occ) !== null)
                .map((occ) => ({
                  occ,
                  prices: days.map((date) => {
                    const dated = s.dateRates.get(`${p.id}|${date}|${occ}`);
                    return { date, pricePaise: dated ?? basePrice(p, occ) ?? 0, dated: dated !== undefined };
                  }),
                })),
            })),
          })),
          blocked: blockedRanges(),
        });
      }),
    /** Cells are checked ONE BY ONE (Pallav), not all-or-nothing: good cells are saved, `error` names the first bad one (null = all saved). */
    saveCalendar: (changes: WebCalendarChanges) =>
      call<{ saved: number; error: string | null }>(() => {
        let saved = 0;
        let error: string | null = null;
        for (const c of changes.inventory) {
          const r = s.rooms.find((x) => x.id === c.roomId);
          if (!r) return mockError('NOT_FOUND');
          const sold = soldOn(r.id, c.date);
          if (!Number.isInteger(c.capacity) || c.capacity < sold || c.capacity > r.totalCount) {
            error ??= websiteCopy.calendar.capacityHint(sold, r.totalCount);
            continue;
          }
          s.capacity.set(`${c.roomId}|${c.date}`, c.capacity);
          saved += 1;
        }
        for (const c of changes.rates) {
          if (!Number.isInteger(c.pricePaise) || c.pricePaise < 0) {
            error ??= 'Enter a price.';
            continue;
          }
          s.dateRates.set(`${c.planId}|${c.date}|${c.occ}`, c.pricePaise);
          saved += 1;
        }
        if (saved) log(`Saved ${saved} calendar ${saved === 1 ? 'change' : 'changes'}`);
        return ok({ saved, error });
      }),
    toggleBlock: (roomId: string, date: string) =>
      call<{ blocked: boolean }>(() => {
        if (!s.rooms.some((r) => r.id === roomId)) return mockError('NOT_FOUND');
        if (soldOn(roomId, date) > 0) return mockError('CONFLICT');
        const k = `${roomId}|${date}`;
        const now = !s.blocked.has(k);
        if (now) s.blocked.add(k);
        else s.blocked.delete(k);
        return ok({ blocked: now });
      }),
    blockRange: (input: WebBlockInput) =>
      call<{ blocked: number; skipped: number; message: string }>(() => {
        const bad = invalid(validateRange(input.start, input.end, input.roomIds));
        if (bad) return bad;
        let blocked = 0;
        let skipped = 0;
        for (const roomId of input.roomIds) {
          for (let dt = input.start; dt <= input.end; dt = addDays(dt, 1)) {
            if (soldOn(roomId, dt) > 0) { skipped += 1; continue; }
            s.blocked.add(`${roomId}|${dt}`);
            blocked += 1;
          }
        }
        log(`Blocked ${blocked} ${blocked === 1 ? 'date' : 'dates'}`);
        return ok({ blocked, skipped, message: `Blocked ${blocked} ${blocked === 1 ? 'date' : 'dates'}.${skipped ? ` ${skipped} skipped: already booked.` : ''}` });
      }),
    unblockRanges: (ranges: { roomId: string; start: string; end: string }[]) =>
      call<{ unblocked: number; message: string }>(() => {
        if (ranges.length === 0) return mockError('VALIDATION_FAILED', { ranges: websiteCopy.calendar.pickOne });
        let n = 0;
        for (const r of ranges) {
          for (let dt = r.start; dt <= r.end; dt = addDays(dt, 1)) if (s.blocked.delete(`${r.roomId}|${dt}`)) n += 1;
        }
        log(`Unblocked ${n} ${n === 1 ? 'date' : 'dates'}`);
        return ok({ unblocked: n, message: websiteCopy.calendar.unblockDone });
      }),
    /** Distinct plan names across rooms, for the bulk update picker. */
    listPlanNames: () => call<string[]>(() => ok([...new Set(s.plans.map((p) => p.name))].sort())),
    bulkRates: (input: WebBulkRatesInput) =>
      call<{ dates: number; rooms: number; skipped: number; message: string }>(() => {
        const fields = validateRange(input.start, input.end, input.roomIds);
        if (!input.planName) fields.planName = websiteCopy.calendar.planMissing;
        if (input.singlePaise === null && input.doublePaise === null && input.extraPaise === null) fields.prices = websiteCopy.calendar.bulkNothing;
        const bad = invalid(fields);
        if (bad) return bad;
        let n = 0;
        for (const p of s.plans.filter((x) => input.roomIds.includes(x.roomId) && x.name === input.planName)) {
          for (let dt = input.start; dt <= input.end; dt = addDays(dt, 1)) {
            if (input.singlePaise !== null) s.dateRates.set(`${p.id}|${dt}|single`, input.singlePaise);
            if (input.doublePaise !== null) s.dateRates.set(`${p.id}|${dt}|double`, input.doublePaise);
            n += 1;
          }
          if (input.extraPaise !== null) p.extraPersonPaise = input.extraPaise;
        }
        log(`Bulk updated ${input.planName} prices`);
        return ok({ dates: n, rooms: input.roomIds.length, skipped: 0, message: websiteCopy.calendar.bulkDone(n) });
      }),

    // ------------------------------------------------ gallery
    listPhotos: () => call<WebPhoto[]>(() => ok(s.photos.map((p) => ({ ...p })))),
    updatePhoto: (id: string, input: { caption: string; altText: string }) =>
      call<WebPhoto>(() => {
        const p = s.photos.find((x) => x.id === id);
        if (!p) return mockError('NOT_FOUND');
        p.caption = input.caption.trim().slice(0, 150);
        p.altText = input.altText.trim().slice(0, 255);
        log('Edited a gallery photo');
        return ok({ ...p });
      }),
    deletePhoto: (id: string) =>
      call<{ id: string }>(() => {
        const i = s.photos.findIndex((x) => x.id === id);
        if (i < 0) return mockError('NOT_FOUND');
        s.photos.splice(i, 1);
        log('Deleted a gallery photo');
        return ok({ id });
      }),
    /** Upload (UI-only until the backend): one photo per picked file, all with the same caption; the caption also becomes the alt text. */
    addPhotos: (input: { caption: string; files: WebFileInput[] }) =>
      call<WebPhoto[]>(() => {
        if (input.files.length === 0) return mockError('VALIDATION_FAILED', { photos: 'Pick at least one photo.' });
        const caption = input.caption.trim().slice(0, 150);
        const added = input.files.map((f, i): WebPhoto => {
          const n = f.fileName;
          const label = caption || n.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
          return { id: nextId('wg'), caption, altText: label, shade: (s.photos.length + i) % 6 };
        });
        s.photos.push(...added);
        log(`Uploaded ${added.length} gallery ${added.length === 1 ? 'photo' : 'photos'}`);
        return ok(added.map((p) => ({ ...p })));
      }),
    movePhoto: (id: string, dir: WebDirection) =>
      call<WebPhoto[]>(() => (moveItem(s.photos, id, dir) ? ok(s.photos.map((p) => ({ ...p }))) : mockError('CONFLICT'))),

    // ------------------------------------------------ content
    getContent: () => call<WebContent>(() => ok({ ...s.content, enquirePoints: [...s.content.enquirePoints] })),
    updateContent: (input: WebContent) =>
      call<WebContent>(() => {
        const fields: FieldErrors = {};
        for (const k of contentRequired) {
          const v = input[k];
          if (typeof v === 'string' && !v.trim()) fields[k] = 'Required.';
        }
        const bad = invalid(fields);
        if (bad) return bad;
        s.content = { ...input, enquirePoints: input.enquirePoints.map((p) => p.trim()).filter(Boolean) };
        log('Changed the home page wording');
        return ok({ ...s.content, enquirePoints: [...s.content.enquirePoints] });
      }),

    // ------------------------------------------------ services / policies / nearby
    listServices: () => call<WebService[]>(() => ok(s.services.map((x) => ({ ...x })))),
    saveService: (id: string | null, input: WebServiceInput) =>
      call<WebService>(() => {
        if (!input.title.trim()) return mockError('VALIDATION_FAILED', { title: websiteCopy.lists.titleMissing });
        if (id) {
          const x = s.services.find((v) => v.id === id);
          if (!x) return mockError('NOT_FOUND');
          Object.assign(x, { title: input.title.trim(), description: input.description.trim(), hasIcon: iconAfter(x.hasIcon, input) });
          log(`Edited service ${x.title}`);
          return ok({ ...x });
        }
        const x: WebService = { id: nextId('ws'), title: input.title.trim(), description: input.description.trim(), hasIcon: Boolean(input.icon) };
        s.services.push(x);
        log(`Added service ${x.title}`);
        return ok({ ...x });
      }),
    listPolicies: () => call<WebPolicyCard[]>(() => ok(s.policies.map((x) => ({ ...x, lines: [...x.lines] })))),
    savePolicy: (id: string | null, input: WebPolicyInput) =>
      call<WebPolicyCard>(() => {
        if (!input.title.trim()) return mockError('VALIDATION_FAILED', { title: websiteCopy.lists.titleMissing });
        const lines = input.lines.map((l) => l.trim()).filter(Boolean);
        if (id) {
          const x = s.policies.find((v) => v.id === id);
          if (!x) return mockError('NOT_FOUND');
          Object.assign(x, { title: input.title.trim(), lines, hasIcon: iconAfter(x.hasIcon, input) });
          log(`Edited rule card ${x.title}`);
          return ok({ ...x, lines: [...x.lines] });
        }
        const x: WebPolicyCard = { id: nextId('wpol'), title: input.title.trim(), lines, hasIcon: Boolean(input.icon) };
        s.policies.push(x);
        log(`Added rule card ${x.title}`);
        return ok({ ...x, lines: [...x.lines] });
      }),
    listNearby: () => call<WebNearbyList>(() => ok({ hotelPinned: s.settings.mapLat !== null, places: s.nearby.map((x) => ({ ...x })) })),
    saveNearby: (id: string | null, input: WebNearbyInput) =>
      call<WebNearbyPlace>(() => {
        const fields: FieldErrors = {};
        if (!input.title.trim()) fields.title = websiteCopy.lists.titleMissing;
        if (input.mapUrl.trim() && !URL_RE.test(input.mapUrl.trim())) fields.mapUrl = websiteCopy.lists.linkInvalid;
        const bad = invalid(fields);
        if (bad) return bad;
        const mapUrl = input.mapUrl.trim();
        const location: WebPlaceLocation = mapUrl ? (s.settings.mapLat !== null ? 'exact' : 'link') : 'name';
        const distanceLabel = input.distanceLabel.trim() || (mapUrl && s.settings.mapLat !== null ? '5.0 km' : '');
        const data = { title: input.title.trim(), distanceLabel, mapUrl, mapQuery: input.mapQuery.trim(), location };
        if (id) {
          const x = s.nearby.find((v) => v.id === id);
          if (!x) return mockError('NOT_FOUND');
          Object.assign(x, data);
          log(`Edited nearby place ${x.title}`);
          return ok({ ...x });
        }
        const x: WebNearbyPlace = { id: nextId('wn'), ...data };
        s.nearby.push(x);
        log(`Added nearby place ${x.title}`);
        return ok({ ...x });
      }),
    deleteListItem: (kind: WebListKind, id: string) =>
      call<{ id: string }>(() => {
        const list: { id: string }[] = kind === 'services' ? s.services : kind === 'policies' ? s.policies : s.nearby;
        const i = list.findIndex((x) => x.id === id);
        if (i < 0) return mockError('NOT_FOUND');
        list.splice(i, 1);
        log(`Removed an item from ${websiteCopy.lists.tabs[kind]}`);
        return ok({ id });
      }),
    moveListItem: (kind: WebListKind, id: string, dir: WebDirection) =>
      call<{ id: string }>(() => {
        const list: { id: string }[] = kind === 'services' ? s.services : kind === 'policies' ? s.policies : s.nearby;
        return moveItem(list, id, dir) ? ok({ id }) : mockError('CONFLICT');
      }),

    // ------------------------------------------------ website live + addresses (decision 55)
    getSite: () => call<WebSite>(() => ok(siteNow())),
    saveSite: (input: WebSiteInput) =>
      call<WebSite>(() => {
        const bad = invalid(validateSiteDomains(input.domains));
        if (bad) return bad;
        const next = input.domains.map((d) => d.trim()).filter(Boolean);
        // the mock pretends another hotel already uses this one
        if (next.includes(SITE_TAKEN)) return mockError('VALIDATION_FAILED', { domains: 'That address is already used by another hotel.' });
        site.live = input.live;
        site.domains = next;
        log(input.live ? 'Switched the website on' : 'Switched the website off');
        return ok(siteNow());
      }),

    // ------------------------------------------------ settings
    getSettings: () => call<WebSettings>(() => ok(publicSettings())),
    updateSettings: (input: WebSettingsInput) =>
      call<WebSettings>(() => {
        const bad = invalid(validateSettings(input));
        if (bad) return bad;
        const { hotelMapUrl, newSmtpPassword, newGoogleMapsApiKey, newGbpOauthClientSecret, logo, favicon, removeLogo, removeFavicon, ...rest } = input;
        Object.assign(s.settings, rest, {
          recipients: input.recipients.map((r) => ({ name: r.name.trim(), email: r.email.trim() })),
        });
        // A new file wins over "Remove", as in Pallav's controller.
        if (logo) s.settings.hasLogo = true;
        else if (removeLogo) s.settings.hasLogo = false;
        if (favicon) s.settings.hasFavicon = true;
        else if (removeFavicon) s.settings.hasFavicon = false;
        if (hotelMapUrl.trim()) {
          s.settings.mapLat = 22.2916;
          s.settings.mapLng = 70.7771;
        }
        if (newSmtpPassword) s.settings.smtpPassword = newSmtpPassword;
        if (newGoogleMapsApiKey.trim()) s.settings.googleMapsApiKey = newGoogleMapsApiKey.trim();
        if (newGbpOauthClientSecret.trim()) s.settings.gbpOauthClientSecret = newGbpOauthClientSecret.trim();
        const configured = s.settings.gbpOauthClientId.trim() !== '' && s.settings.gbpOauthClientSecret !== '';
        if (!configured) s.settings.googleStatus = 'notSetUp';
        else if (s.settings.googleStatus === 'notSetUp') s.settings.googleStatus = 'ready';
        log('Changed the website settings');
        return ok(publicSettings());
      }),
    googleConnect: () =>
      call<WebSettings>(() => {
        if (s.settings.googleStatus === 'notSetUp') return mockError('CONFLICT');
        Object.assign(s.settings, { googleStatus: 'connected', googleLastFetchedAt: new Date().toISOString(), googleReviewCount: 128 });
        log('Connected Google Business Profile');
        return ok(publicSettings());
      }),
    googleRefresh: () =>
      call<WebSettings>(() => {
        if (s.settings.googleStatus !== 'connected') return mockError('CONFLICT');
        Object.assign(s.settings, { googleLastFetchedAt: new Date().toISOString(), googleReviewCount: s.settings.googleReviewCount + 2 });
        return ok(publicSettings());
      }),
    googleDisconnect: () =>
      call<WebSettings>(() => {
        Object.assign(s.settings, { googleStatus: 'ready', googleLastFetchedAt: null, googleReviewCount: 5 });
        log('Disconnected Google Business Profile');
        return ok(publicSettings());
      }),
  };
}

const contentRequired: WebContentKey[] = webContentSections.flatMap((sec) => sec.fields.filter((f) => f.required).map((f) => f.key));
