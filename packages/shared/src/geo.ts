/**
 * Minimal Iranian geography reference used by the campaign builder and market dashboard.
 * Not exhaustive — it is a convenience list, and any free-text city is still accepted.
 */

export interface Province {
  name: string;
  nameEn: string;
  cities: string[];
}

export const IRAN_PROVINCES: Province[] = [
  { name: 'مرکزی', nameEn: 'Markazi', cities: ['اراک', 'ساوه', 'خمین', 'محلات', 'دلیجان', 'شازند', 'تفرش'] },
  { name: 'تهران', nameEn: 'Tehran', cities: ['تهران', 'کرج', 'اسلامشهر', 'شهریار', 'ورامین', 'پاکدشت'] },
  { name: 'اصفهان', nameEn: 'Isfahan', cities: ['اصفهان', 'کاشان', 'نجف‌آباد', 'خمینی‌شهر', 'شاهین‌شهر'] },
  { name: 'خراسان رضوی', nameEn: 'Razavi Khorasan', cities: ['مشهد', 'نیشابور', 'سبزوار', 'تربت حیدریه'] },
  { name: 'فارس', nameEn: 'Fars', cities: ['شیراز', 'مرودشت', 'جهرم', 'کازرون', 'فسا'] },
  { name: 'آذربایجان شرقی', nameEn: 'East Azerbaijan', cities: ['تبریز', 'مراغه', 'مرند', 'اهر'] },
  { name: 'آذربایجان غربی', nameEn: 'West Azerbaijan', cities: ['ارومیه', 'خوی', 'میاندوآب', 'بوکان'] },
  { name: 'خوزستان', nameEn: 'Khuzestan', cities: ['اهواز', 'آبادان', 'دزفول', 'خرمشهر', 'بندر ماهشهر'] },
  { name: 'گیلان', nameEn: 'Gilan', cities: ['رشت', 'بندر انزلی', 'لاهیجان', 'لنگرود'] },
  { name: 'مازندران', nameEn: 'Mazandaran', cities: ['ساری', 'بابل', 'آمل', 'قائم‌شهر', 'چالوس'] },
  { name: 'قم', nameEn: 'Qom', cities: ['قم'] },
  { name: 'البرز', nameEn: 'Alborz', cities: ['کرج', 'فردیس', 'نظرآباد'] },
  { name: 'کرمان', nameEn: 'Kerman', cities: ['کرمان', 'رفسنجان', 'سیرجان', 'بم'] },
  { name: 'یزد', nameEn: 'Yazd', cities: ['یزد', 'میبد', 'اردکان'] },
  { name: 'همدان', nameEn: 'Hamadan', cities: ['همدان', 'ملایر', 'نهاوند'] },
  { name: 'کرمانشاه', nameEn: 'Kermanshah', cities: ['کرمانشاه', 'اسلام‌آباد غرب', 'کنگاور'] },
  { name: 'گلستان', nameEn: 'Golestan', cities: ['گرگان', 'گنبد کاووس', 'علی‌آباد'] },
  { name: 'قزوین', nameEn: 'Qazvin', cities: ['قزوین', 'تاکستان', 'الوند'] },
  { name: 'اردبیل', nameEn: 'Ardabil', cities: ['اردبیل', 'پارس‌آباد', 'مشگین‌شهر'] },
  { name: 'زنجان', nameEn: 'Zanjan', cities: ['زنجان', 'ابهر', 'خرمدره'] },
  { name: 'لرستان', nameEn: 'Lorestan', cities: ['خرم‌آباد', 'بروجرد', 'دورود'] },
  { name: 'بوشهر', nameEn: 'Bushehr', cities: ['بوشهر', 'برازجان', 'گناوه'] },
  { name: 'هرمزگان', nameEn: 'Hormozgan', cities: ['بندرعباس', 'قشم', 'میناب'] },
  { name: 'سیستان و بلوچستان', nameEn: 'Sistan and Baluchestan', cities: ['زاهدان', 'زابل', 'چابهار'] },
  { name: 'کردستان', nameEn: 'Kurdistan', cities: ['سنندج', 'سقز', 'مریوان'] },
  { name: 'سمنان', nameEn: 'Semnan', cities: ['سمنان', 'شاهرود', 'دامغان', 'گرمسار'] },
  { name: 'چهارمحال و بختیاری', nameEn: 'Chaharmahal and Bakhtiari', cities: ['شهرکرد', 'بروجن'] },
  { name: 'خراسان شمالی', nameEn: 'North Khorasan', cities: ['بجنورد', 'شیروان', 'اسفراین'] },
  { name: 'خراسان جنوبی', nameEn: 'South Khorasan', cities: ['بیرجند', 'قائن', 'طبس'] },
  { name: 'ایلام', nameEn: 'Ilam', cities: ['ایلام', 'دهلران', 'آبدانان'] },
  { name: 'کهگیلویه و بویراحمد', nameEn: 'Kohgiluyeh and Boyer-Ahmad', cities: ['یاسوج', 'دوگنبدان'] },
];

export const ALL_CITIES: string[] = Array.from(
  new Set(IRAN_PROVINCES.flatMap((p) => p.cities)),
).sort();

export function provinceForCity(city: string): string | null {
  const needle = city.trim();
  for (const p of IRAN_PROVINCES) {
    if (p.cities.some((c) => c === needle)) return p.name;
  }
  return null;
}

/**
 * Business categories offered in the campaign builder. Free text is also accepted —
 * this list only drives the picker.
 */
export const BUSINESS_CATEGORIES: Array<{ key: string; fa: string; en: string; osm?: string[] }> = [
  { key: 'dental_clinic', fa: 'کلینیک دندانپزشکی', en: 'Dental clinic', osm: ['amenity=dentist'] },
  { key: 'beauty_clinic', fa: 'کلینیک زیبایی', en: 'Beauty clinic', osm: ['shop=beauty', 'amenity=clinic'] },
  { key: 'medical_clinic', fa: 'کلینیک پزشکی', en: 'Medical clinic', osm: ['amenity=clinic', 'amenity=doctors'] },
  { key: 'pharmacy', fa: 'داروخانه', en: 'Pharmacy', osm: ['amenity=pharmacy'] },
  { key: 'restaurant', fa: 'رستوران', en: 'Restaurant', osm: ['amenity=restaurant'] },
  { key: 'cafe', fa: 'کافه', en: 'Cafe', osm: ['amenity=cafe'] },
  { key: 'retail_store', fa: 'فروشگاه', en: 'Retail store', osm: ['shop=convenience', 'shop=supermarket', 'shop=clothes'] },
  { key: 'clothing', fa: 'پوشاک', en: 'Clothing', osm: ['shop=clothes'] },
  { key: 'furniture', fa: 'مبلمان', en: 'Furniture', osm: ['shop=furniture'] },
  { key: 'manufacturer', fa: 'تولیدی و صنعتی', en: 'Manufacturer', osm: ['man_made=works', 'landuse=industrial'] },
  { key: 'education', fa: 'آموزشگاه', en: 'Education', osm: ['amenity=school', 'amenity=language_school', 'amenity=college'] },
  { key: 'professional_services', fa: 'خدمات تخصصی', en: 'Professional services', osm: ['office=lawyer', 'office=accountant', 'office=consulting'] },
  { key: 'real_estate', fa: 'املاک', en: 'Real estate', osm: ['office=estate_agent'] },
  { key: 'hotel', fa: 'هتل و اقامتگاه', en: 'Hotel', osm: ['tourism=hotel', 'tourism=guest_house'] },
  { key: 'gym', fa: 'باشگاه ورزشی', en: 'Gym', osm: ['leisure=fitness_centre', 'leisure=sports_centre'] },
  { key: 'auto', fa: 'خودرو', en: 'Automotive', osm: ['shop=car', 'shop=car_repair'] },
  { key: 'jewelry', fa: 'طلا و جواهر', en: 'Jewelry', osm: ['shop=jewelry'] },
  { key: 'bakery', fa: 'نانوایی و شیرینی', en: 'Bakery', osm: ['shop=bakery', 'shop=pastry'] },
  { key: 'travel_agency', fa: 'آژانس مسافرتی', en: 'Travel agency', osm: ['shop=travel_agency'] },
  { key: 'veterinary', fa: 'دامپزشکی', en: 'Veterinary', osm: ['amenity=veterinary'] },
];
