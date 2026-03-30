import { config } from "./config.js";
import { SearchResult } from "./knowledge/service.js";
import { KnowledgeService } from "./knowledge/service.js";
import {
  byLanguage,
  detectPreferredLanguage,
  normalizeVietnameseChatText,
  PreferredLanguage
} from "./language.js";
import { getRelevantAnswerTrainingExamples } from "./prompt-training.js";
import { answerWithGemini, routeDormQuestion } from "./llm.js";
import {
  buildAvailabilityContext,
  buildAvailabilityFallback,
  checkProspectReferral,
  fetchProspectAvailability,
  fetchProspectPublicSettings,
  formatVnd,
  ProspectReferralInput,
  questionMentionsReferral,
  questionNeedsAvailability
} from "./prospect.js";
import { KnowledgeTopic } from "./knowledge/types.js";

const ACCOUNT_SPECIFIC_PATTERNS = [
  /\bmy coins?\b/i,
  /\bmy balance\b/i,
  /\bmy payment\b/i,
  /\bmy booking\b/i,
  /\bmy fine\b/i,
  /\bmy account\b/i,
  /\btài khoản của tôi\b/i,
  /\bcoin của tôi\b/i,
  /\bphạt của tôi\b/i
];

const RESIDENT_DISCLOSURE_PATTERNS = [
  /\bwho\s+(is|stays|lives).*(room|bed)\b/i,
  /\bresident\s+(name|phone|number)\b/i,
  /\bclient\s+(name|phone|number)\b/i,
  /\bwho is in bed\b/i,
  /\bwho is in room\b/i,
  /\b(ai đang ở|tên khách|số điện thoại khách)\b/i
];

const ALLOWED_TOPIC_PATTERNS = [
  /\b(stay|dorm|hostel|room|bed|branch|move[- ]?in|contract|cancel|policy|discount|referral|coins?|laundry|cleaning|rules?)\b/i,
  /\b(cozoro|d2|d7)\b/i,
  /(còn giường|giường trống|phòng trống|hợp đồng|hủy|giảm giá|ưu đãi|khuyến mãi|khuyen mai|km\b|giới thiệu|laundry|giặt|dọn vệ sinh|nội quy|xem phòng|xem phong|tham quan|thamquan|đến xem|den xem|ghé xem|ghe xem|coi phòng|coi phong|đặt lịch|dat lich|xem nhà|xem nha|địa chỉ|dia chi|ở đâu|o dau|chi nhánh|chi nhanh|bao nhiêu người|bao nhieu nguoi|tư vấn|tu van|nhắn tin|nhan tin|inbox|ib\b)/i,
  /\b\d+\s*(tháng|thang)\b/i
];

const PRIVATE_REFERRAL_DETAILS_PATTERN =
  /\b(referral|referred|refer|introduce|giới thiệu)\b/i;

const BOT_IDENTITY_PATTERNS = [
  /\bwho are you\b/i,
  /\bwhat are you\b/i,
  /\bwho r u\b/i,
  /(bạn là ai|ban la ai|mày là ai|may la ai|m la ai|mày la ai|bot là ai|bot la ai)/i
];

const HUMAN_HANDOFF_PATTERNS = [
  /\b(human|agent|staff|representative|talk to a human)\b/i,
  /(gặp người thật|gặp nhân viên|gặp admin|gặp quản lý|chuyển (giúp )?sang (nhân viên|người thật)|nói chuyện với (nhân viên|người thật)|chat với (nhân viên|người thật)|cần (người|nhân viên) tư vấn)/i,
  /(cho (mình|em|a|chị|anh) nói chuyện với (nhân viên|người thật))/i
];

const HOTLINE_PATTERNS = [
  /\b(hotline|phone number|call)\b/i,
  /(số điện thoại|sdt|liên hệ|gọi số|hotline)/i
];

export function questionRequestsHuman(question: string) {
  return HUMAN_HANDOFF_PATTERNS.some((pattern) => pattern.test(question));
}

export function questionAsksHotline(question: string) {
  return HOTLINE_PATTERNS.some((pattern) => pattern.test(question));
}

const LANGUAGE_SWITCH_TO_VI_PATTERNS = [
  /(nói tiếng việt|noi tieng viet|trả lời bằng tiếng việt|tra loi bang tieng viet|dùng tiếng việt|dung tieng viet)/i
];

const LANGUAGE_SWITCH_TO_EN_PATTERNS = [
  /\b(speak english|use english|reply in english|answer in english)\b/i,
  /(nói tiếng anh|noi tieng anh|trả lời bằng tiếng anh|tra loi bang tieng anh)/i
];

const VIEWING_PATTERNS = [
  /\b(visit|tour|viewing)\b/i,
  /(xem phòng|xem phong|tham quan|thamquan|đến xem|den xem|ghé xem|ghe xem|coi phòng|coi phong|xem nhà|xem nha|đặt lịch|dat lich)/i
];

const ADDRESS_PATTERNS = [
  /\b(address|location|where)\b/i,
  /(địa chỉ|dia chi|ở đâu|o dau|chi nhánh ở đâu|chi nhanh o dau|nằm ở đâu|nam o dau)/i
];

const ROOM_CAPACITY_PATTERNS = [
  /\b(how many people per room|room capacity|people per room)\b/i,
  /(phòng bao nhiêu người|phong bao nhieu nguoi|một phòng bao nhiêu người|mot phong bao nhieu nguoi|bao nhiêu người 1 phòng|bao nhieu nguoi 1 phong)/i
];

const LAUNDRY_PATTERNS = [
  /\blaundry\b/i,
  /\bwasher\b/i,
  /(giặt|giat|máy giặt|may giat)/i
];

const DRYER_PATTERNS = [
  /\bdryer\b/i,
  /(máy sấy|may say|sấy đồ|say do)/i
];

const COINS_PATTERNS = [
  /\bcoins?\b/i,
  /(cozoro coins|điểm|diem|coin)/i
];

const DAILY_STAY_PATTERNS = [
  /\bdaily\b/i,
  /(theo ngày|theo ngay|ở theo ngày|o theo ngay|giá ngày|gia ngay|price per day|per day)\b/i,
  /(100k\/ngày|100k\/ngay|100000\/ngày|100000\/ngay)/i
];

const REFERRAL_DISCOUNT_QUESTION_PATTERNS = [
  /\breferral discount\b/i,
  /(ưu đãi giới thiệu|uu dai gioi thieu|giảm giá giới thiệu|giam gia gioi thieu)/i
];

const PRICE_PATTERNS = [
  /\b(price|pricing|cost|rent|monthly price)\b/i,
  /(giá|gia|bao nhiêu|bao nhieu|bn|chi phí|chi phi|tiền phòng|tien phong|tiền ở|tien o|phí ở|phi o)/i
];

const DISCOUNT_PATTERNS = [
  /\b(discount|promotion|promo|offer|deal)\b/i,
  /(khuyến mãi|khuyen mai|ưu đãi|uu dai|giảm giá|giam gia|khuyến mại|km\b)/i
];

const SHORT_TERM_PRICE_PATTERNS = [
  /\bshort[- ]?term\b/i,
  /(ngắn hạn|ngan han)/i,
  /\b[1-5]\s*(tháng|thang)\b/i
];

const VAGUE_AMOUNT_PATTERNS = [
  /^(là|la)\s*bao\s*(nhiêu|nhieu|nhiu)\??$/i,
  /^bao\s*(nhiêu|nhieu|nhiu)\??$/i,
  /^thế\s*(nào|nao)\??$/i
];

const INSULT_PATTERNS = [
  /\b(stupid|dumb|idiot)\b/i,
  /(ngu|khùng|khùng|đần|dan|ngu vậy|ngu the|ngu thế)/i
];

function detectBranchForPricing(question: string) {
  if (
    /\b(d7|dorm 7)\b/i.test(question) ||
    /(thành thái|thanh thai|quận 10|quan 10|district 10|q10)/i.test(question)
  ) {
    return "d7";
  }

  if (
    /\b(d2|dorm 2)\b/i.test(question) ||
    /(hậu giang|hau giang|quận 6|quan 6|district 6|q6)/i.test(question)
  ) {
    return "d2";
  }

  return null;
}

function extractStayDurationMonths(question: string) {
  const normalized = question
    .replace(/\./g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const match = normalized.match(/\b(\d{1,2})\s*(thang|tháng)\b/);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 24) {
    return null;
  }

  return value;
}

function buildHumanContactLine(language: PreferredLanguage) {
  return byLanguage(
    language,
    `Để Cozoro chốt giá cuối cùng đúng ưu đãi theo hồ sơ, quý khách có thể nhắn “gặp người thật” hoặc gọi ${config.hotline} giúp Cozoro nha.`,
    `For the final confirmed price, you can ask to talk to a human agent or call ${config.hotline}.`
  );
}

function formatSources(results: SearchResult[]) {
  const uniqueResults = results.filter(
    (result, index) =>
      results.findIndex(
        (candidate) => candidate.title === result.title && candidate.source === result.source
      ) === index
  );
  return uniqueResults
    .map((result, index) => `${index + 1}. ${result.title} (${result.source})`)
    .join("\n");
}

function buildContext(results: SearchResult[], liveContext?: string) {
  const knowledgeContext = results
    .map(
      (result, index) =>
        `Source ${index + 1}: ${result.title}\nLocation: ${result.source}\nContent:\n${result.content}`
    )
    .join("\n\n");

  return [liveContext?.trim(), knowledgeContext].filter(Boolean).join("\n\n");
}

function buildFallbackAnswer(
  question: string,
  results: SearchResult[],
  language: PreferredLanguage,
  liveNotes: string[] = []
) {
  if (liveNotes.length) {
    return liveNotes.join(" ");
  }

  if (!results.length) {
    return byLanguage(
      language,
      "Cozoro hiện chưa có đủ dữ liệu đã duyệt để trả lời câu này thật gọn và thật chuẩn cho quý khách. Quý khách nhắn staff giúp Cozoro nhé, hoặc Cozoro sẽ cần bổ sung thêm tài liệu phù hợp hơn.",
      "I do not have enough approved knowledge to answer that yet. Please ask a staff member or add the relevant policy document to the bot knowledge base."
    );
  }

  const snippets = results
    .slice(0, 2)
    .map((result) => `"${result.content.slice(0, 220).trim()}"`)
    .join(" ");

  return byLanguage(
    language,
    "Cozoro có thông tin liên quan, nhưng để trả lời thật gọn và thật chuẩn cho quý khách thì Cozoro khuyên nên xác nhận thêm với staff nhé.",
    [
      `I found related information for "${question}", but staff should confirm the final answer for accuracy.`
    ].join(" ")
  );
}

async function generateOpenAiAnswer(
  question: string,
  results: SearchResult[],
  preferredLanguage: PreferredLanguage,
  liveContext?: string,
  conversationContext?: string
) {
  const normalizedQuestion = normalizeVietnameseChatText(question);
  const normalizedConversation = conversationContext?.trim()
    ? normalizeVietnameseChatText(conversationContext.trim())
    : "";
  const answerTrainingExamples = await getRelevantAnswerTrainingExamples(normalizedQuestion, 4);

  const systemPrompt = [
    "You are the Cozorohome prospective-client assistant.",
    "Answer only from the provided context.",
    "If the answer is not clearly supported by the context, say you are not sure and recommend human support.",
    "Do not invent discounts, policies, fees, or cancellation rules.",
    "Never reveal any current client identity, phone number, room assignment, or account detail.",
    "If referral eligibility is provided in the live context, only say eligible or not eligible.",
    "Keep the answer short, friendly, and sales-supportive (prefer 1 to 3 short sentences).",
    "Do not dump raw notes or internal instructions.",
    "Do not include a Sources section unless the customer explicitly asks for sources.",
    "Always refer to yourself as Cozoro.",
    "In Vietnamese, address the customer politely as 'quý khách' and keep a witty, warm, lightly feminine tone.",
    "Understand Vietnamese slang, teencode, and acronyms from customer messages.",
    "When replying in Vietnamese, keep it concise and natural with light chat style (for example: 'ạ', 'nha').",
    `If the customer asks for a final quote or wants to book, suggest contacting the owner/manager hotline ${config.hotline} or asking for a human agent.`,
    preferredLanguage === "vi"
      ? "Default language: Vietnamese. Only use English if the customer clearly asked in English."
      : "Reply in English because the customer used or requested English."
  ].join(" ");

  const userPrompt = [
    answerTrainingExamples.length
      ? [
          "Relevant approved local Cozoro answer examples:",
          ...answerTrainingExamples.map(
            (example, index) =>
              `${index + 1}. Customer: ${example.question}\n   Cozoro: ${example.answer}\n   Source: ${example.source}`
          ),
          ""
        ].join("\n")
      : "",
    normalizedConversation ? `Conversation so far:\n${normalizedConversation}\n` : "",
    `Customer question: ${normalizedQuestion}`,
    "",
    "Retrieved context:",
    buildContext(results, liveContext),
    "",
    "Write the best safe answer."
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openAiApiKey}`
    },
    body: JSON.stringify({
      model: config.openAiModel,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: userPrompt }]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed with ${response.status}: ${errorText}`);
  }

  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  const outputText =
    payload.output_text?.trim() ??
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text ?? "")
      .join("")
      .trim();

  if (!outputText) {
    throw new Error("OpenAI response did not include text output");
  }

  return outputText;
}

type AnswerOptions = {
  referral?: ProspectReferralInput | null;
  conversationContext?: string;
};

function buildOffTopicAnswer(language: PreferredLanguage) {
  return byLanguage(
    language,
    "Cozoro xin phép chỉ hỗ trợ các câu hỏi về ở tại Cozoro thôi nha quý khách, như giường trống, hợp đồng, hủy ở, ưu đãi, referral, Cozoro Coins, giặt sấy, vệ sinh và nội quy. Quý khách cần hỏi về chỗ ở tại Cozoro thì nhắn Cozoro là đúng bài luôn đó ạ.",
    "I can only help with Cozoro stay, dorm, bed availability, contract policy, cancellation, discounts, referral, Cozoro Coins, laundry, cleaning, and dorm rules. If you have a question about staying at Cozoro, send it here and I will help."
  );
}

function buildIdentityAnswer(language: PreferredLanguage) {
  return byLanguage(
    language,
    "Cozoro đây ạ, Cozoro chat bot agent luôn nha quý khách. Cozoro hỗ trợ tư vấn giá, giường trống, tiện ích, giặt sấy, hợp đồng, ưu đãi và chính sách ở ạ.",
    "I am Cozoro chatbot agent. I can help with pricing, bed availability, amenities, laundry, contracts, promotions, and stay policies."
  );
}

function buildLanguageSwitchAnswer(language: PreferredLanguage) {
  return byLanguage(
    language,
    "Dạ được quý khách ơi, Cozoro sẽ trả lời bằng tiếng Việt nha. Quý khách cứ hỏi về giá, giường trống, tiện ích, ưu đãi hoặc hợp đồng, Cozoro trực sẵn đây ạ.",
    "Sure, I can reply in English. You can ask me about pricing, bed availability, amenities, promotions, or contract policy."
  );
}

function buildViewingAnswer(language: PreferredLanguage) {
  return byLanguage(
    language,
    "Dạ được nha quý khách. Quý khách muốn ghé xem chi nhánh nào (D7 Thành Thái Q10 hay D2 Hậu Giang Q6) và khoảng mấy giờ ạ? Quý khách cho Cozoro xin số điện thoại để Cozoro hỗ trợ giữ lịch và chỉ đường cho tiện nữa nha.",
    "Yes. Which branch do you want to visit (Dorm 7 or Dorm 2) and what time works for you? Share a phone number and I’ll help confirm the viewing."
  );
}

function buildAddressAnswer(language: PreferredLanguage) {
  return byLanguage(
    language,
    [
      "Dạ Cozoro có 2 chi nhánh chính nha quý khách:",
      "1) D7: Hẻm 7A/19 Thành Thái, Phường Diên Hồng, TP.HCM (khu Quận 10 cũ).",
      "2) D2: 491 Hậu Giang, Phường 11, Quận 6, TP.HCM.",
      "Quý khách muốn xem chi nhánh nào để Cozoro chỉ đường và giữ lịch xem nhà giúp mình ạ?"
    ].join(" "),
    [
      "Cozoro currently has two main branches:",
      "1) Dorm 7: Alley 7A/19 Thanh Thai, Dien Hong Ward, HCMC (old District 10 area).",
      "2) Dorm 2: 491 Hau Giang, Ward 11, District 6, HCMC.",
      "Tell me which branch you prefer and I can help with directions and viewing schedule."
    ].join(" ")
  );
}

function buildRoomCapacityAnswer(language: PreferredLanguage) {
  return byLanguage(
    language,
    [
      "Dạ Cozoro thường có phòng khoảng 6 đến 9 người tối đa nha quý khách (tùy phòng/chi nhánh).",
      "Bên Cozoro không thiết kế phòng 4 giường kiểu cố định đâu ạ.",
      "Nếu quý khách muốn ở ít người hơn, Cozoro sẽ ưu tiên sắp xếp phòng thưa trước để mình trải nghiệm cho thoải mái nha."
    ].join(" "),
    [
      "Cozoro rooms are usually around 6 to 9 residents max, depending on branch and room layout.",
      "There is no fixed 4-bed room format.",
      "If you prefer fewer roommates, we can prioritize a less crowded room first."
    ].join(" ")
  );
}

function buildRespectfulBoundaryAnswer(language: PreferredLanguage) {
  return byLanguage(
    language,
    "Cozoro xin lỗi nếu vừa rồi trả lời chưa đúng ý quý khách nha. Quý khách hỏi lại giúp Cozoro 1 câu ngắn theo nhu cầu chính (giá, ưu đãi, địa chỉ, số người/phòng, xem nhà), Cozoro trả lời đúng trọng tâm liền ạ.",
    "Sorry if my previous answer missed your point. Please send one short question (price, discounts, address, room capacity, or viewing), and I’ll answer it directly."
  );
}

type FollowupIntent = "discount" | "price" | "address" | "room_capacity" | null;

function inferFollowupIntentFromContext(conversationContext: string): FollowupIntent {
  const context = conversationContext.toLowerCase();

  if (
    /(ưu đãi|uu dai|khuyến mãi|khuyen mai|gói 3|goi 3|gói 6|goi 6|giảm|giam|discount|promotion)/i.test(
      context
    )
  ) {
    return "discount";
  }

  if (/(phòng bao nhiêu người|phong bao nhieu nguoi|room capacity|people per room)/i.test(context)) {
    return "room_capacity";
  }

  if (/(địa chỉ|dia chi|ở đâu|o dau|address|location)/i.test(context)) {
    return "address";
  }

  if (/(giá|gia|chi phí|chi phi|price|rent|1\.8|1,8|1\.7|1,7|1\.4|1,4)/i.test(context)) {
    return "price";
  }

  return null;
}

function buildLaundryAnswer(language: PreferredLanguage) {
  return byLanguage(
    language,
    "Có nha quý khách. Cozoro có khu giặt cho cư dân: D2 có máy giặt, còn D7 có cả máy giặt và máy sấy. Mỗi tháng thường có lượt giặt miễn phí (nam 6, nữ 8). Nếu vượt lượt miễn phí thì phí tham khảo đang là 15.000 VND/lượt, và cũng có thể thanh toán bằng Cozoro Coins trong một số trường hợp ạ.",
    "Yes. Cozoro provides laundry for residents. There is usually a free monthly quota (male 6, female 8). If you exceed the free quota, the current reference is 15,000 VND per use, and Cozoro Coins can also be used in some cases."
  );
}

function buildDryerAnswer(language: PreferredLanguage) {
  return byLanguage(
    language,
    "Có nha quý khách. D7 có máy sấy. Nếu quý khách dùng vượt lượt miễn phí thì thường tính theo lượt (tham khảo 15.000 VND/lượt) và cũng có thể thanh toán bằng Cozoro Coins trong một số trường hợp ạ.",
    "Yes. Dorm 7 has dryers. If you exceed the free quota, it is typically charged per use (reference 15,000 VND/use) and Cozoro Coins can also be used in some cases."
  );
}

function buildDailyStayAnswer(language: PreferredLanguage) {
  return byLanguage(
    language,
    [
      "Dạ có gói ở theo ngày nha quý khách. Mức tham khảo hiện tại là 100.000 VND/ngày.",
      "Vì gói theo ngày hay có điều kiện kèm theo (tối thiểu số ngày, giữ giấy tờ/cọc), nên quý khách cho Cozoro xin chi nhánh (D7 hay D2) và số ngày dự kiến để Cozoro chốt chuẩn giúp mình ạ.",
      buildHumanContactLine(language)
    ].join(" "),
    [
      "Yes, daily stay is possible. The current reference is 100,000 VND/day.",
      "Daily stays often have conditions (minimum days, ID retention or deposit), so tell me the branch (Dorm 7 or Dorm 2) and the number of days.",
      buildHumanContactLine(language)
    ].join(" ")
  );
}

function buildDiscountAnswer(language: PreferredLanguage) {
  return byLanguage(
    language,
    [
      "Dạ có nhiều ưu đãi lắm nha quý khách. Mặc định gần như lúc nào cũng có:",
      "1) Gói 6 tháng: tặng thêm 1 tháng (ở tháng thứ 7).",
      "2) Gói 3 tháng: giảm 500.000 VND.",
      "Ngoài ra thường có ưu đãi theo hồ sơ như sinh viên, nhân viên y tế, và một số chương trình theo thời điểm nữa ạ.",
      "Quý khách cho Cozoro xin: muốn ở D7 (Thành Thái Q10) hay D2 (Hậu Giang Q6), và dự định ở mấy tháng để Cozoro chốt mức rẻ nhất giúp mình nha.",
      buildHumanContactLine(language)
    ].join(" "),
    [
      "Yes, Cozoro usually has multiple discounts.",
      "Common always-on offers include: a 6-month package with 1 extra month free (7th month), and a 3-month package discount of 500,000 VND.",
      "There may also be profile-based discounts (students, healthcare workers) and time-limited campaigns.",
      "Tell me which branch (Dorm 7 or Dorm 2) and how many months you plan to stay, and I’ll guide you to the best options.",
      buildHumanContactLine(language)
    ].join(" ")
  );
}

function buildDurationFollowupAnswer(months: number, language: PreferredLanguage) {
  const surchargeLine =
    months <= 2
      ? "Vì ở 1-2 tháng là ngắn hạn nên thường có phụ phí +12% trên giá cơ bản ạ."
      : months >= 3 && months <= 5
        ? "Vì ở 3-5 tháng là ngắn hạn nên thường có phụ phí +8% trên giá cơ bản ạ."
        : "";

  const packageLine =
    months === 3
      ? "Nếu quý khách ở 3 tháng thì mình có gói 3 tháng giảm 500.000 VND nữa nha."
      : months >= 6
        ? "Nếu quý khách cân nhắc gói 6 tháng thì thường được tặng thêm 1 tháng (ở tháng thứ 7) nên trung bình mỗi tháng sẽ mềm hơn nhiều ạ."
        : "Cozoro vẫn có nhiều ưu đãi theo hồ sơ như sinh viên, nhân viên y tế, cọc online, v.v. ạ.";

  return byLanguage(
    language,
    [
      `Dạ ở ${months} tháng được nha quý khách.`,
      packageLine,
      surchargeLine,
      "Quý khách cho Cozoro xin ở chi nhánh nào (D7 Thành Thái Q10 hay D2 Hậu Giang Q6) và quý khách thuộc nhóm sinh viên/NVYT không để Cozoro chốt mức rẻ nhất giúp mình nha.",
      buildHumanContactLine(language)
    ]
      .filter(Boolean)
      .join(" "),
    [
      `Yes, a ${months}-month stay is possible.`,
      months === 3
        ? "There is usually a 3-month package discount of 500,000 VND."
        : months >= 6
          ? "A 6-month package often includes 1 extra month free (7th month), so the effective monthly cost is usually lower."
          : "There are often additional discounts depending on your profile and current campaigns.",
      months <= 2 ? "Short stays (1–2 months) may include a +12% surcharge on the base price." : "",
      months >= 3 && months <= 5 ? "Short stays (3–5 months) may include a +8% surcharge on the base price." : "",
      buildHumanContactLine(language)
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function buildPriceAnswer(question: string, language: PreferredLanguage) {
  const branch = detectBranchForPricing(question);
  const mentionsShortTerm = SHORT_TERM_PRICE_PATTERNS.some((pattern) => pattern.test(question));
  const adjust10Percent = (value: number) => Math.round(value * 1.1);

  if (language === "en") {
    const branchLine =
      branch === "d7"
        ? "For Dorm 7, the current reference listed price is about 1,870,000 VND for the upper bed and 1,980,000 VND for the middle or lower bed (about 10% higher than the older table)."
        : branch === "d2"
          ? "For Dorm 2, the current reference listed price is about 1,760,000 VND (upper), 1,870,000 VND (middle), and 1,980,000 VND (lower) (about 10% higher than the older table)."
          : "Reference listed prices are about 10% higher than the older table: Dorm 7 is ~1,870,000 / 1,980,000 VND and Dorm 2 is ~1,760,000 / 1,870,000 / 1,980,000 VND by bed level.";

    const shortTermLine = mentionsShortTerm
      ? "If the stay is under 6 months, a short-term surcharge may apply: 1-2 months +12%, 3-5 months +8% on the base price."
      : "";

    return [
      branchLine,
      shortTermLine,
      "But the real net monthly price is often lower after discounts. With packages and eligibility, it can be around 1,400,000 VND/month, and in some cases as low as ~1,200,000 VND/month plus parking (not guaranteed).",
      buildHumanContactLine(language)
    ]
      .filter(Boolean)
      .join(" ");
  }

  const d7Upper = adjust10Percent(1_700_000);
  const d7MidLow = adjust10Percent(1_800_000);
  const d2Upper = adjust10Percent(1_600_000);
  const d2Middle = adjust10Percent(1_700_000);
  const d2Lower = adjust10Percent(1_800_000);

  const branchLine =
    branch === "d7"
      ? `Dạ Dorm 7 hiện Cozoro đang tư vấn giá tham khảo mới (đã +~10% so với bảng cũ) là giường trên ${formatVnd(d7Upper)}/tháng, còn giường giữa và giường dưới là ${formatVnd(d7MidLow)}/tháng nha quý khách.`
      : branch === "d2"
        ? `Dạ Dorm 2 hiện Cozoro đang tư vấn giá tham khảo mới (đã +~10% so với bảng cũ) là giường trên ${formatVnd(d2Upper)}/tháng, giường giữa ${formatVnd(d2Middle)}/tháng và giường dưới ${formatVnd(d2Lower)}/tháng nha quý khách.`
        : `Dạ giá tham khảo mới Cozoro đang tư vấn (đã +~10% so với bảng cũ) là: Dorm 7 giường trên ${formatVnd(d7Upper)}/tháng, giường giữa hoặc dưới ${formatVnd(d7MidLow)}/tháng; Dorm 2 là ${formatVnd(d2Upper)}, ${formatVnd(d2Middle)}, ${formatVnd(d2Lower)}/tháng theo giường trên, giữa, dưới nha quý khách.`;

  const shortTermLine = mentionsShortTerm
    ? "Nếu quý khách ở dưới 6 tháng thì có thể có phụ phí ngắn hạn: 1-2 tháng +12%, 3-5 tháng +8% trên giá cơ bản nữa ạ."
    : "";

  return [
    branchLine,
    shortTermLine,
    "Nhưng giá thực trả mỗi tháng thường còn mềm hơn giá niêm yết nữa vì Cozoro có nhiều khuyến mãi và ưu đãi theo gói. Thực tế nếu đóng theo gói thì hay về tầm 1.400.000 VND/tháng, và trường hợp tối ưu có thể xuống khoảng 1.200.000 VND/tháng + phí gửi xe (tùy hồ sơ và từng thời điểm, nên Cozoro sẽ chốt lại theo điều kiện của quý khách nha).",
    buildHumanContactLine(language)
  ]
    .filter(Boolean)
    .join(" ");
}

function inferSearchTopic(question: string, conversationContext: string): KnowledgeTopic {
  if (ROOM_CAPACITY_PATTERNS.some((pattern) => pattern.test(question))) return "room_capacity";
  if (ADDRESS_PATTERNS.some((pattern) => pattern.test(question))) return "location";
  if (questionNeedsAvailability(question)) return "availability";
  if (questionMentionsReferral(question)) return "referral";
  if (COINS_PATTERNS.some((pattern) => pattern.test(question))) return "coins";
  if (LAUNDRY_PATTERNS.some((pattern) => pattern.test(question)) || DRYER_PATTERNS.some((pattern) => pattern.test(question))) return "laundry";
  if (PRICE_PATTERNS.some((pattern) => pattern.test(question))) return "pricing";
  if (DISCOUNT_PATTERNS.some((pattern) => pattern.test(question))) return "discount";
  if (/(hợp đồng|hop dong|hủy|huy|chính sách|chinh sach|policy|contract|rules|nội quy|noi quy)/i.test(question)) return "policy";

  const intentFromContext = inferFollowupIntentFromContext(conversationContext);
  if (intentFromContext === "discount") return "discount";
  if (intentFromContext === "price") return "pricing";
  if (intentFromContext === "address") return "location";
  if (intentFromContext === "room_capacity") return "room_capacity";
  return "general";
}

export async function answerCustomerQuestion(
  knowledgeService: KnowledgeService,
  question: string,
  options?: AnswerOptions
) {
  const normalizedQuestion = normalizeVietnameseChatText(question);
  const preferredLanguage = detectPreferredLanguage(normalizedQuestion);
  const conversationContext = options?.conversationContext?.trim() ?? "";

  if (BOT_IDENTITY_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))) {
    return buildIdentityAnswer(preferredLanguage);
  }

  if (LANGUAGE_SWITCH_TO_VI_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))) {
    return buildLanguageSwitchAnswer("vi");
  }

  if (LANGUAGE_SWITCH_TO_EN_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))) {
    return buildLanguageSwitchAnswer("en");
  }

  if (VIEWING_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))) {
    return buildViewingAnswer(preferredLanguage);
  }

  if (ADDRESS_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))) {
    return buildAddressAnswer(preferredLanguage);
  }

  if (ROOM_CAPACITY_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))) {
    return buildRoomCapacityAnswer(preferredLanguage);
  }

  if (DRYER_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))) {
    return buildDryerAnswer(preferredLanguage);
  }

  if (LAUNDRY_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))) {
    return buildLaundryAnswer(preferredLanguage);
  }

  if (DAILY_STAY_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))) {
    return buildDailyStayAnswer(preferredLanguage);
  }

  if (questionAsksHotline(normalizedQuestion)) {
    return byLanguage(
      preferredLanguage,
      `Dạ hotline hỗ trợ của Cozoro là ${config.hotline} nha quý khách. Quý khách muốn ở chi nhánh nào (D7 Thành Thái Q10 hay D2 Hậu Giang Q6) và dự định ở mấy tháng để Cozoro tư vấn đúng ưu đãi cho mình ạ?`,
      `Cozoro hotline is ${config.hotline}. Which branch (Dorm 7 or Dorm 2) and how many months do you plan to stay?`
    );
  }

  if (
    DISCOUNT_PATTERNS.some((pattern) => pattern.test(normalizedQuestion)) &&
    !questionMentionsReferral(normalizedQuestion)
  ) {
    return buildDiscountAnswer(preferredLanguage);
  }

  if (
    VAGUE_AMOUNT_PATTERNS.some((pattern) => pattern.test(normalizedQuestion)) &&
    conversationContext &&
    !questionMentionsReferral(normalizedQuestion)
  ) {
    const intent = inferFollowupIntentFromContext(conversationContext);
    if (intent === "discount") {
      return buildDiscountAnswer(preferredLanguage);
    }
    if (intent === "room_capacity") {
      return buildRoomCapacityAnswer(preferredLanguage);
    }
    if (intent === "address") {
      return buildAddressAnswer(preferredLanguage);
    }
    if (intent === "price") {
      return buildPriceAnswer(question, preferredLanguage);
    }
  }

  if (
    PRICE_PATTERNS.some((pattern) => pattern.test(normalizedQuestion)) &&
    !questionMentionsReferral(normalizedQuestion)
  ) {
    return buildPriceAnswer(normalizedQuestion, preferredLanguage);
  }

  const months = extractStayDurationMonths(normalizedQuestion);
  if (months && normalizedQuestion.trim().length <= 40 && !questionMentionsReferral(normalizedQuestion)) {
    // Handles short follow-ups like "mình ở 3 tháng" using chat context implicitly.
    return buildDurationFollowupAnswer(months, preferredLanguage);
  }

  if (ACCOUNT_SPECIFIC_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))) {
    return byLanguage(
      preferredLanguage,
      "Cozoro có thể hỗ trợ quý khách về chính sách chung, ưu đãi, hủy hợp đồng và thông tin dịch vụ. Còn các câu hỏi gắn với tài khoản cá nhân thì hiện staff cần xác nhận riêng giúp quý khách nha.",
      "I can help with general policies, discounts, cancellation rules, and service information. Personal account answers are not enabled yet in this bot, so a staff member should verify anything tied to your balance, fines, or bookings."
    );
  }

  if (
    RESIDENT_DISCLOSURE_PATTERNS.some((pattern) => pattern.test(normalizedQuestion)) &&
    !questionMentionsReferral(normalizedQuestion)
  ) {
    return byLanguage(
      preferredLanguage,
      "Cozoro có thể hỗ trợ quý khách về giường trống, chính sách chung và điều kiện ưu đãi giới thiệu. Nhưng Cozoro không thể tiết lộ danh tính hay thông tin liên hệ của khách đang ở đâu ạ.",
      "I can help with bed availability, general policies, and referral eligibility. I cannot reveal any current client identity or contact details."
    );
  }

  if (INSULT_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))) {
    return buildRespectfulBoundaryAnswer(preferredLanguage);
  }

  const liveNotes: string[] = [];
  let liveContext = "";
  const referral = options?.referral;
  const hasStrongDormSignal =
    ALLOWED_TOPIC_PATTERNS.some((pattern) => pattern.test(normalizedQuestion)) ||
    Boolean(months) ||
    questionMentionsReferral(normalizedQuestion) ||
    questionNeedsAvailability(normalizedQuestion);

  if (
    PRIVATE_REFERRAL_DETAILS_PATTERN.test(normalizedQuestion) &&
    /\+?\d[\d\s().-]{6,}\d/.test(normalizedQuestion)
  ) {
    return byLanguage(
      preferredLanguage,
      "Cozoro có thể kiểm tra điều kiện ưu đãi giới thiệu theo cách riêng tư, nhưng mình không nên đưa số điện thoại vào luồng chat chung đâu ạ. Quý khách dùng luồng kiểm tra referral giúp Cozoro nhé, hệ thống sẽ chỉ trả về đủ điều kiện hay chưa đủ điều kiện thôi.",
      "I can check referral eligibility privately, but I should not send referral phone details into the general answer flow. Please use the referral check path so I only return eligible or not eligible."
    );
  }

  if (questionNeedsAvailability(normalizedQuestion)) {
    try {
      const availability = await fetchProspectAvailability();
      const summary = buildAvailabilityFallback(availability, preferredLanguage);
      liveNotes.push(summary);
      liveContext = [liveContext, buildAvailabilityContext(availability)].filter(Boolean).join("\n\n");
    } catch (error) {
      console.warn("[bot] Failed to load prospect availability", error);
    }
  }

  if (referral?.name.trim() && referral.phone.trim()) {
    try {
      const referralResult = await checkProspectReferral(referral);
      liveNotes.push(
        byLanguage(
          preferredLanguage,
          `${referralResult.eligible ? "Quý khách đủ điều kiện nhận ưu đãi giới thiệu rồi nha." : "Hiện tại quý khách chưa đủ điều kiện nhận ưu đãi giới thiệu nhé."} Mức ưu đãi giới thiệu đang là ${formatVnd(referralResult.referralDiscountVnd)}.`,
          `${referralResult.message} Referral discount: ${formatVnd(referralResult.referralDiscountVnd)}.`
        )
      );
      liveContext = [
        liveContext,
        preferredLanguage === "vi"
          ? `Kết quả kiểm tra referral: ${referralResult.eligible ? "đủ điều kiện" : "không đủ điều kiện"}.`
          : `Referral eligibility result: ${referralResult.eligible ? "eligible" : "not eligible"}.`,
        `Referral discount amount: ${referralResult.referralDiscountVnd} VND.`
      ]
        .filter(Boolean)
        .join("\n\n");
    } catch (error) {
      console.warn("[bot] Failed to verify referral eligibility", error);
    }
  } else if (questionMentionsReferral(normalizedQuestion)) {
    try {
      const settings = await fetchProspectPublicSettings();
      liveNotes.push(
        byLanguage(
          preferredLanguage,
          `Ưu đãi giới thiệu hiện tại là ${formatVnd(settings.referralDiscountVnd)} nha quý khách. Để đủ điều kiện, hệ thống cần kiểm tra riêng tư bằng cả tên và số điện thoại của một khách đang ở hiện tại.`,
          `The current referral discount is ${formatVnd(settings.referralDiscountVnd)}. A prospect is eligible only after a private check using both the referral name and phone number of one current staying client.`
        )
      );
      liveContext = [
        liveContext,
        preferredLanguage === "vi"
          ? `Mức ưu đãi giới thiệu: ${settings.referralDiscountVnd} VND.`
          : `Referral discount amount: ${settings.referralDiscountVnd} VND.`,
        preferredLanguage === "vi"
          ? "Quy tắc kiểm tra referral: cần cả tên và số điện thoại, sau đó chỉ trả về đủ điều kiện hoặc không đủ điều kiện."
          : "Referral eligibility rule: require both the referral name and phone number, then return only eligible or not eligible."
      ]
        .filter(Boolean)
        .join("\n\n");
    } catch (error) {
      console.warn("[bot] Failed to load referral settings", error);
    }
  }

  if (
    REFERRAL_DISCOUNT_QUESTION_PATTERNS.some((pattern) => pattern.test(normalizedQuestion)) &&
    liveNotes.length
  ) {
    return liveNotes.join(" ");
  }

  const searchTopic = inferSearchTopic(normalizedQuestion, conversationContext);
  const results = knowledgeService.search(normalizedQuestion, { topic: searchTopic });

  if (!hasStrongDormSignal) {
    if (config.llmProvider === "gemini" && config.geminiApiKey) {
      try {
        const route = await routeDormQuestion(normalizedQuestion, conversationContext);
        if (route.decision === "deny" || route.route === "off_topic") {
          return buildOffTopicAnswer(preferredLanguage);
        }
      } catch (error) {
        console.warn("[bot] Falling back after Gemini route error", error);
        return buildOffTopicAnswer(preferredLanguage);
      }
    } else {
      return buildOffTopicAnswer(preferredLanguage);
    }
  }

  if (config.llmProvider === "gemini" && config.geminiApiKey && (results.length || liveContext.trim())) {
    try {
      const route = await routeDormQuestion(normalizedQuestion, conversationContext);
      if ((route.decision === "deny" || route.route === "off_topic") && !hasStrongDormSignal) {
        return buildOffTopicAnswer(preferredLanguage);
      }

      return await answerWithGemini({
        question: normalizedQuestion,
        results,
        liveContext,
        conversationContext,
        preferredLanguage
      });
    } catch (error) {
      console.warn("[bot] Falling back after Gemini route error", error);
    }
  }

  try {
    if (config.llmProvider === "openai" && config.openAiApiKey && (results.length || liveContext.trim())) {
      return await generateOpenAiAnswer(
        normalizedQuestion,
        results,
        preferredLanguage,
        liveContext,
        conversationContext
      );
    }
  } catch (error) {
    console.warn("[bot] Falling back after OpenAI error", error);
  }

  const fallback = buildFallbackAnswer(question, results, preferredLanguage, liveNotes);
  return fallback;
}
