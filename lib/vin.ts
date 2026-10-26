/** VIN helpers that run anywhere (browser or server) */

const WMI: Record<string, string> = {
  // South African plants
  AHT: "Toyota", AAV: "Volkswagen", ADM: "General Motors", ADN: "Nissan", ADB: "Mercedes-Benz", AAM: "MAN", AFA: "Ford", ACV: "Isuzu", AC5: "Hyundai",
  ADR: "Renault", AFB: "Mazda", ABM: "BMW", ADD: "Mercedes-Benz", AAP: "Volkswagen", AFF: "Ford",
  // Japan
  JTE: "Toyota", JTD: "Toyota", JTM: "Toyota", JTN: "Toyota", JTH: "Lexus", JT1: "Toyota", JT2: "Toyota", JT3: "Toyota",
  JN1: "Nissan", JN8: "Nissan", JMB: "Mitsubishi", JMY: "Mitsubishi", JMZ: "Mazda", JM1: "Mazda", JHM: "Honda", JHL: "Honda",
  JS2: "Suzuki", JS3: "Suzuki", JSA: "Suzuki", JF1: "Subaru", JF2: "Subaru", JAA: "Isuzu", JAL: "Isuzu",
  // Korea
  KMH: "Hyundai", KNA: "Kia", KND: "Kia", KNM: "Renault Samsung", KPT: "SsangYong", KL1: "Chevrolet",
  // India and Thailand
  MA3: "Suzuki", MAL: "Hyundai", MAT: "Tata", MA1: "Mahindra", MAJ: "Ford", MZB: "Kia", MBH: "Suzuki",
  MR0: "Toyota", MR1: "Toyota", MR2: "Toyota", MNT: "Nissan", MMB: "Mitsubishi", MMM: "Chevrolet", MPA: "Isuzu", MM8: "Mazda", MNA: "Ford", MNB: "Ford",
  // China
  LGW: "GWM (Haval)", LGX: "BYD", LJD: "Kia", LVS: "Ford", LSV: "Volkswagen", LFV: "Volkswagen", LRW: "Tesla", LNB: "BAIC", L6T: "Geely", LSJ: "MG", LVV: "Chery", LDC: "Peugeot",
  // Europe
  WVW: "Volkswagen", WVG: "Volkswagen", WV1: "Volkswagen", WV2: "Volkswagen", WAU: "Audi", WUA: "Audi", WA1: "Audi",
  WDB: "Mercedes-Benz", WDD: "Mercedes-Benz", WDC: "Mercedes-Benz", W1K: "Mercedes-Benz", W1N: "Mercedes-Benz", W1V: "Mercedes-Benz",
  WBA: "BMW", WBS: "BMW", WBX: "BMW", WBY: "BMW", WMW: "MINI", WP0: "Porsche", WP1: "Porsche", W0L: "Opel", WF0: "Ford",
  VF1: "Renault", VF3: "Peugeot", VF7: "Citroën", VSS: "SEAT", TMB: "Škoda", ZFA: "Fiat", ZAR: "Alfa Romeo", ZFF: "Ferrari",
  SAL: "Land Rover", SAJ: "Jaguar", SCC: "Lotus", YV1: "Volvo", YV4: "Volvo",
  // Americas
  "1FT": "Ford", "1FA": "Ford", "1G1": "Chevrolet", "1C4": "Jeep", "1J4": "Jeep", "2T1": "Toyota", "3VW": "Volkswagen", "5YJ": "Tesla", "9BW": "Volkswagen",
};

const YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";

/** Clean what a scanner or person typed into a VIN: uppercase, no spaces, drop the leading I that some door-jamb barcodes add */
export function cleanVin(raw: string): string {
  let v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (v.length === 18 && v.startsWith("I")) v = v.slice(1);
  return v;
}

export function vinProblem(vin: string): string | null {
  if (!vin) return "Enter the VIN";
  if (vin.length !== 17) return `A VIN has 17 characters; this has ${vin.length}`;
  if (/[IOQ]/.test(vin)) return "VINs never contain I, O or Q. Check for 1, 0 and 0";
  return null;
}

/** Best guess from the VIN alone. The model year code repeats every 30 years, so pick the most recent match that isn't in the future. */
export function decodeVinLocal(vin: string): { make: string | null; year: number | null } {
  const make = WMI[vin.slice(0, 3)] ?? null;
  const code = vin[9];
  let year: number | null = null;
  const idx = code ? YEAR_CODES.indexOf(code) : -1;
  if (idx >= 0) {
    const max = new Date().getFullYear() + 1;
    let y = 1980 + idx;
    while (y + 30 <= max) y += 30;
    year = y;
  }
  return { make, year };
}
