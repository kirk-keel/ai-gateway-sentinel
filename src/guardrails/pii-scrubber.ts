import { PiiScrubResult, PiiViolation } from './types.js';

interface RedactionRule {
  category: string;
  replacementToken: string;
  regex: RegExp;
  description: string;
}

export const OPERATIONAL_PII_RULES: RedactionRule[] = [
  // 1. API Well Numbers (10, 12, or 14-digit US well identifiers, with or without dashes)
  {
    category: 'WELL_API_NUMBER',
    replacementToken: '[REDACTED_WELL_API]',
    regex: /\b(?:API\s*(?:#|no\.?|number)?:?\s*)?(?:\d{2}[-\s]?\d{3}[-\s]?\d{5}(?:[-\s]?\d{2}(?:[-\s]?\d{2})?)?)\b/gi,
    description: 'API / US Well Identification Number',
  },

  // 2. Wellhead / Drillpad Geographic Coordinates (Lat/Long, GPS coordinates, UTM notation)
  {
    category: 'GEOGRAPHIC_COORDINATES',
    replacementToken: '[REDACTED_COORDINATES]',
    regex: /(?:(?:Lat(?:itude)?\s*[:=]?\s*)?[-+]?(?:[1-8]?\d(?:\.\d{3,8})?|90(?:\.0{3,8})?)\s*(?:°|deg)?\s*[NS]?(?:[\s,;\/]+|\s+and\s+)(?:Lon(?:gitude)?\s*[:=]?\s*)?[-+]?(?:180(?:\.0{3,8})?|(?:1[0-7]\d|[1-9]?\d)(?:\.\d{3,8})?)\s*(?:°|deg)?\s*[EW]?|\bZone\s+\d{1,2}[A-Z]\s+\d{6,7}\s*mE\s+\d{6,7}\s*mN\b)/gi,
    description: 'Drillpad and Wellhead GPS/UTM coordinates',
  },

  // 3. Legal Land Description (PLSS: Section / Township / Range)
  {
    category: 'PLSS_LEGAL_LAND',
    replacementToken: '[REDACTED_PLSS_LOCATION]',
    regex: /\b(?:Sec(?:tion)?\.?\s*\d{1,2}|S\d{1,2})[\s,\-]+(?:T(?:ownship)?\.?\s*\d{1,2}\s*[NSEW]|T\d{1,2}[NSEW])[\s,\-]+(?:R(?:ange)?\.?\s*\d{1,2}\s*[NSEW]|R\d{1,2}[NSEW])\b/gi,
    description: 'PLSS Section-Township-Range legal land description',
  },

  // 4. Offshore Blocks & Lease IDs (e.g. OCS-G 12345, Green Canyon Block 252)
  {
    category: 'OFFSHORE_LEASE_BLOCK',
    replacementToken: '[REDACTED_OFFSHORE_BLOCK]',
    regex: /\b(?:OCS[-\s]?[A-Z][-\s]?\d{4,6}|(?:Mississippi\s+Canyon|Green\s+Canyon|Garden\s+Banks|Keathley\s+Canyon|Alaminos\s+Canyon|Walker\s+Ridge)\s+(?:Block|Blk)?\s*\d{1,4})\b/gi,
    description: 'Offshore OCS lease and exploration blocks',
  },

  // 5. Confidential Stratigraphic Formations & Reservoirs
  {
    category: 'CONFIDENTIAL_FORMATION',
    replacementToken: '[REDACTED_FORMATION]',
    regex: /\b(?:Wolfcamp(?:\s+[A-D])?|Eagle\s+Ford|Bakken|Bone\s+Spring|Spraberry|Haynesville|Niobrara|Three\s+Forks|Woodford|Austin\s+Chalk|Marcellus|Tuscaloosa\s+Marine\s+Shale|Smackover|Permian\s+Basin|Delaware\s+Basin|Midland\s+Basin|Wilcox(?:\s+Formation)?)\b/gi,
    description: 'Confidential petroleum formation tops and basins',
  },

  // 6. Drill Depths (MD - Measured Depth, TVD - True Vertical Depth, subsea depths)
  {
    category: 'DRILL_DEPTH',
    replacementToken: '[REDACTED_DRILL_DEPTH]',
    regex: /\b(?:(?:TVD|MD|TVDSS|measured\s+depth|true\s+vertical\s+depth)\s*[:=]?\s*[\d,]+(?:\.\d+)?\s*(?:ft|feet|m|meters)?|[\d,]+(?:\.\d+)?\s*(?:ft|feet|'|m|meters)\s*(?:TVD|MD|TVDSS))\b/gi,
    description: 'True Vertical Depth (TVD) and Measured Depth (MD) data',
  },

  // 7. Reservoir Petrophysical & Production Metrics (Permeability, Porosity, EUR, STOIIP, IP30)
  {
    category: 'RESERVOIR_METRICS',
    replacementToken: '[REDACTED_RESERVOIR_METRICS]',
    regex: /\b(?:(?:permeability|porosity|EUR|STOIIP|OOIP|IP24|IP30|BOPD|MCFD|MBOE)\s*[:=]?\s*[\d,]+(?:\.\d+)?\s*(?:mD|millidarcies|mdarcy|%|BOPD|MCFD|MBOE|MMBO|BCF)?|[\d,]+(?:\.\d+)?\s*(?:mD|millidarcies|mdarcy)\b|[\d,]+(?:\.\d+)?\s*%\s*(?:porosity|phi|Sw)\b)/gi,
    description: 'Reservoir petrophysical properties and confidential production rates',
  },

  // 8. Secrets & API Keys (AWS, OpenAI, GitHub tokens, Bearer tokens)
  {
    category: 'API_SECRET_KEY',
    replacementToken: '[REDACTED_SECRET_KEY]',
    regex: /\b(?:AKIA[0-9A-Z]{16}|sk-[a-zA-Z0-9_\-]{20,}|ghp_[a-zA-Z0-9]{36}|bearer\s+[a-zA-Z0-9_\-\.]{25,})\b/gi,
    description: 'Cloud API credentials and private access tokens',
  },

  // 9. Social Security Numbers
  {
    category: 'SSN',
    replacementToken: '[REDACTED_SSN]',
    regex: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,
    description: 'Social Security Number',
  },

  // 10. Email addresses
  {
    category: 'EMAIL_ADDRESS',
    replacementToken: '[REDACTED_EMAIL]',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g,
    description: 'Email address',
  },

  // 11. Phone numbers (standard domestic and international patterns)
  {
    category: 'PHONE_NUMBER',
    replacementToken: '[REDACTED_PHONE]',
    regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    description: 'Telephone number',
  },
];

export interface ScrubOptions {
  rules?: RedactionRule[];
  customRules?: RedactionRule[];
  disabledCategories?: string[];
}

export function scrubOperationalPII(
  text: string,
  options: ScrubOptions = {}
): PiiScrubResult {
  if (!text || typeof text !== 'string') {
    return {
      hasPii: false,
      cleanText: text,
      violations: [],
      counts: {},
    };
  }

  const disabled = new Set(options.disabledCategories || []);
  const activeRules = [
    ...(options.rules || OPERATIONAL_PII_RULES),
    ...(options.customRules || []),
  ].filter((r) => !disabled.has(r.category));

  let cleanText = text;
  const violations: PiiViolation[] = [];
  const counts: Record<string, number> = {};

  for (const rule of activeRules) {
    // Reset RegExp state if it has global flag
    rule.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    // First collect all matches for this rule
    while ((match = rule.regex.exec(text)) !== null) {
      const matchedText = match[0];
      violations.push({
        category: rule.category,
        matchedText,
        replacementToken: rule.replacementToken,
        index: match.index,
      });

      counts[rule.category] = (counts[rule.category] || 0) + 1;

      // Prevent infinite loop on 0-width match
      if (match.index === rule.regex.lastIndex) {
        rule.regex.lastIndex++;
      }
    }

    // Apply substitution to cleanText
    rule.regex.lastIndex = 0;
    cleanText = cleanText.replace(rule.regex, rule.replacementToken);
  }

  return {
    hasPii: violations.length > 0,
    cleanText,
    violations,
    counts,
  };
}
