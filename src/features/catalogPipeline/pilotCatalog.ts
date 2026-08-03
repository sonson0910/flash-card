import { createLexemeId, createTrackMembershipId } from '../multilingual/lexemeIdentity';
import type { LexemeV3, TrackMembershipV3 } from '../multilingual/schemaV3';
import type {
  CatalogCandidateProvenanceV1,
  CatalogLexemeCandidateV1,
  CatalogMembershipCandidateV1,
  CatalogSourceBundleV1,
} from './catalogContracts';

type PilotTier = 'foundation' | 'core' | 'advanced';
type Seed = readonly [lemma: string, vietnamese: string, partOfSpeech: 'noun' | 'verb' | 'adjective'];

const PILOT_TIMESTAMP = '2026-08-03T00:00:00.000Z';

const PROVENANCE: CatalogCandidateProvenanceV1 = Object.freeze({
  schemaVersion: 1,
  sourceRef: 'internal-phase3-pilot',
  sourceUrl: null,
  licenseId: 'NOASSERTION',
  attribution: 'AI-assisted internal learning draft; rights and accuracy require human review.',
  authorId: 'codex-phase3-generator',
  origin: 'ai-assisted',
  generator: { provider: 'openai', model: 'gpt-5-phase3-pilot' },
  publishability: 'non-publishable',
});

const parseSeeds = (source: string): readonly Seed[] => source.trim().split('\n').map((line) => {
  const [lemma, vietnamese, partOfSpeech, unexpected] = line.split('|');
  if (!lemma || !vietnamese || !partOfSpeech || unexpected !== undefined) {
    throw new TypeError(`Invalid pilot seed: ${line}`);
  }
  if (!['noun', 'verb', 'adjective'].includes(partOfSpeech)) {
    throw new TypeError(`Invalid pilot part of speech: ${partOfSpeech}`);
  }
  return [lemma, vietnamese, partOfSpeech as Seed[2]];
});

const FOUNDATION_SEEDS = parseSeeds(`
ability|khả năng|noun
action|hành động|noun
activity|hoạt động|noun
advice|lời khuyên|noun
answer|câu trả lời|noun
area|khu vực|noun
arrival|sự đến nơi|noun
attention|sự chú ý|noun
balance|sự cân bằng|noun
behavior|hành vi|noun
benefit|lợi ích|noun
choice|lựa chọn|noun
community|cộng đồng|noun
conversation|cuộc trò chuyện|noun
courage|lòng can đảm|noun
culture|văn hóa|noun
customer|khách hàng|noun
decision|quyết định|noun
direction|phương hướng|noun
education|giáo dục|noun
effort|nỗ lực|noun
energy|năng lượng|noun
environment|môi trường|noun
example|ví dụ|noun
experience|kinh nghiệm|noun
family|gia đình|noun
feature|đặc điểm|noun
friendship|tình bạn|noun
future|tương lai|noun
goal|mục tiêu|noun
habit|thói quen|noun
health|sức khỏe|noun
home|nhà|noun
idea|ý tưởng|noun
information|thông tin|noun
interest|sự quan tâm|noun
journey|hành trình|noun
knowledge|kiến thức|noun
language|ngôn ngữ|noun
learning|việc học|noun
message|tin nhắn|noun
mistake|lỗi|noun
money|tiền|noun
need|nhu cầu|noun
opportunity|cơ hội|noun
order|đơn hàng|noun
place|địa điểm|noun
plan|kế hoạch|noun
problem|vấn đề|noun
question|câu hỏi|noun
reason|lý do|noun
result|kết quả|noun
safety|sự an toàn|noun
service|dịch vụ|noun
skill|kỹ năng|noun
solution|giải pháp|noun
story|câu chuyện|noun
success|thành công|noun
support|sự hỗ trợ|noun
team|đội nhóm|noun
time|thời gian|noun
travel|việc du lịch|noun
value|giá trị|noun
work|công việc|noun
achieve|đạt được|verb
choose|lựa chọn|verb
compare|so sánh|verb
complete|hoàn thành|verb
create|tạo ra|verb
describe|mô tả|verb
develop|phát triển|verb
discuss|thảo luận|verb
explain|giải thích|verb
improve|cải thiện|verb
include|bao gồm|verb
increase|tăng lên|verb
learn|học|verb
manage|quản lý|verb
notice|nhận thấy|verb
prepare|chuẩn bị|verb
remember|ghi nhớ|verb
reduce|giảm bớt|verb
share|chia sẻ|verb
solve|giải quyết|verb
understand|hiểu|verb
use|sử dụng|verb
welcome|chào đón|verb
accept|chấp nhận|verb
available|có sẵn|adjective
careful|cẩn thận|adjective
clear|rõ ràng|adjective
common|phổ biến|adjective
different|khác nhau|adjective
easy|dễ dàng|adjective
important|quan trọng|adjective
possible|có thể|adjective
ready|sẵn sàng|adjective
safe|an toàn|adjective
simple|đơn giản|adjective
useful|hữu ích|adjective
`);

const CORE_SEEDS = parseSeeds(`
access|quyền truy cập|noun
account|tài khoản|noun
agreement|thỏa thuận|noun
analysis|sự phân tích|noun
approach|cách tiếp cận|noun
assessment|sự đánh giá|noun
audience|khán giả|noun
authority|thẩm quyền|noun
budget|ngân sách|noun
capacity|năng lực|noun
challenge|thách thức|noun
communication|sự giao tiếp|noun
competition|sự cạnh tranh|noun
complaint|khiếu nại|noun
condition|điều kiện|noun
confidence|sự tự tin|noun
consequence|hậu quả|noun
contract|hợp đồng|noun
contribution|sự đóng góp|noun
demand|nhu cầu|noun
department|phòng ban|noun
detail|chi tiết|noun
device|thiết bị|noun
economy|nền kinh tế|noun
employment|việc làm|noun
evidence|bằng chứng|noun
feedback|phản hồi|noun
finance|tài chính|noun
growth|sự tăng trưởng|noun
impact|tác động|noun
industry|ngành công nghiệp|noun
issue|vấn đề cần xử lý|noun
leadership|khả năng lãnh đạo|noun
management|sự quản lý|noun
market|thị trường|noun
measure|biện pháp|noun
method|phương pháp|noun
objective|mục tiêu cụ thể|noun
performance|hiệu suất|noun
policy|chính sách|noun
process|quy trình|noun
product|sản phẩm|noun
project|dự án|noun
quality|chất lượng|noun
research|nghiên cứu|noun
resource|nguồn lực|noun
responsibility|trách nhiệm|noun
schedule|lịch trình|noun
strategy|chiến lược|noun
survey|khảo sát|noun
task|nhiệm vụ|noun
technology|công nghệ|noun
training|đào tạo|noun
trend|xu hướng|noun
workforce|lực lượng lao động|noun
adjust|điều chỉnh|verb
allocate|phân bổ|verb
analyze|phân tích|verb
assess|đánh giá|verb
assume|giả định|verb
calculate|tính toán|verb
communicate|giao tiếp|verb
conduct|tiến hành|verb
confirm|xác nhận|verb
consider|cân nhắc|verb
contribute|đóng góp|verb
coordinate|phối hợp|verb
deliver|cung cấp|verb
demonstrate|chứng minh|verb
determine|xác định|verb
evaluate|đánh giá toàn diện|verb
expand|mở rộng|verb
identify|nhận diện|verb
implement|triển khai|verb
maintain|duy trì|verb
negotiate|đàm phán|verb
organize|tổ chức|verb
participate|tham gia|verb
predict|dự đoán|verb
recommend|đề xuất|verb
respond|phản hồi|verb
review|xem xét|verb
summarize|tóm tắt|verb
transfer|chuyển giao|verb
verify|xác minh|verb
accurate|chính xác|adjective
appropriate|phù hợp|adjective
competitive|có tính cạnh tranh|adjective
consistent|nhất quán|adjective
efficient|hiệu quả về nguồn lực|adjective
effective|có hiệu quả|adjective
essential|thiết yếu|adjective
flexible|linh hoạt|adjective
independent|độc lập|adjective
practical|thực tế|adjective
reliable|đáng tin cậy|adjective
relevant|có liên quan|adjective
responsible|có trách nhiệm|adjective
specific|cụ thể|adjective
successful|thành công|adjective
`);

const ADVANCED_SEEDS = parseSeeds(`
abstraction|sự trừu tượng hóa|noun
accessibility|khả năng tiếp cận|noun
accountability|trách nhiệm giải trình|noun
ambiguity|sự mơ hồ|noun
anomaly|điểm bất thường|noun
assumption|giả định|noun
authenticity|tính xác thực|noun
causality|quan hệ nhân quả|noun
coherence|tính mạch lạc|noun
collaboration|sự hợp tác|noun
compliance|sự tuân thủ|noun
constraint|hạn chế|noun
correlation|mối tương quan|noun
credibility|độ tin cậy|noun
criterion|tiêu chí|noun
deficiency|sự thiếu hụt|noun
diversity|sự đa dạng|noun
efficiency|hiệu suất sử dụng nguồn lực|noun
equity|sự công bằng|noun
ethics|đạo đức|noun
evaluation|sự thẩm định|noun
framework|khung phương pháp|noun
hypothesis|giả thuyết|noun
implication|hàm ý|noun
incentive|động lực khuyến khích|noun
inequality|sự bất bình đẳng|noun
innovation|sự đổi mới|noun
insight|sự thấu hiểu|noun
integrity|tính chính trực|noun
intervention|sự can thiệp|noun
methodology|phương pháp luận|noun
mitigation|sự giảm thiểu|noun
nuance|sắc thái tinh tế|noun
paradigm|hệ hình|noun
perspective|góc nhìn|noun
phenomenon|hiện tượng|noun
priority|mức độ ưu tiên|noun
probability|xác suất|noun
productivity|năng suất|noun
rationale|cơ sở lý luận|noun
regulation|quy định|noun
resilience|khả năng phục hồi|noun
sustainability|tính bền vững|noun
validity|tính hợp lệ|noun
variability|tính biến thiên|noun
volatility|sự biến động|noun
acknowledge|thừa nhận|verb
anticipate|dự liệu|verb
articulate|diễn đạt rõ ràng|verb
ascertain|xác minh chắc chắn|verb
challenge|chất vấn|verb
clarify|làm rõ|verb
compile|tổng hợp|verb
conceptualize|khái niệm hóa|verb
consolidate|củng cố|verb
constrain|hạn chế|verb
contradict|mâu thuẫn với|verb
deduce|suy luận|verb
differentiate|phân biệt|verb
diminish|làm suy giảm|verb
disclose|tiết lộ|verb
facilitate|tạo điều kiện|verb
formulate|xây dựng có hệ thống|verb
generalize|khái quát hóa|verb
illustrate|minh họa|verb
infer|suy ra|verb
integrate|tích hợp|verb
interpret|diễn giải|verb
justify|biện minh|verb
mediate|làm trung gian|verb
optimize|tối ưu hóa|verb
reconcile|dung hòa|verb
reinforce|củng cố thêm|verb
scrutinize|xem xét kỹ lưỡng|verb
synthesize|tổng hợp thành hệ thống|verb
validate|xác nhận tính hợp lệ|verb
arbitrary|tùy ý|adjective
coherent|mạch lạc|adjective
compelling|thuyết phục|adjective
comprehensive|toàn diện|adjective
concurrent|đồng thời|adjective
controversial|gây tranh cãi|adjective
cumulative|tích lũy|adjective
empirical|dựa trên thực nghiệm|adjective
explicit|tường minh|adjective
implicit|ngầm hiểu|adjective
inherent|vốn có|adjective
innovative|đổi mới|adjective
marginal|không đáng kể|adjective
plausible|hợp lý và có thể xảy ra|adjective
prevalent|phổ biến rộng rãi|adjective
provisional|tạm thời|adjective
robust|vững chắc|adjective
significant|đáng kể|adjective
sophisticated|tinh vi|adjective
subtle|tinh tế|adjective
systematic|có hệ thống|adjective
transparent|minh bạch|adjective
unprecedented|chưa từng có|adjective
viable|có khả năng thực hiện|adjective
`);

const TIER_SEEDS: readonly (readonly [PilotTier, readonly Seed[]])[] = [
  ['foundation', FOUNDATION_SEEDS],
  ['core', CORE_SEEDS],
  ['advanced', ADVANCED_SEEDS],
];

const exampleFor = (lemma: string, vietnamese: string, partOfSpeech: Seed[2]) => {
  if (partOfSpeech === 'verb') return {
    text: `Learners can ${lemma} the idea in a practical situation.`,
    translation: `Người học có thể ${vietnamese} ý tưởng trong một tình huống thực tế.`,
    collocation: `${lemma} effectively`,
  };
  if (partOfSpeech === 'adjective') return {
    text: `The example shows why the result can be ${lemma}.`,
    translation: `Ví dụ cho thấy vì sao kết quả có thể ${vietnamese}.`,
    collocation: `highly ${lemma}`,
  };
  return {
    text: `The lesson explains ${lemma} through a practical example.`,
    translation: `Bài học giải thích ${vietnamese} qua một ví dụ thực tế.`,
    collocation: `understand ${lemma}`,
  };
};

const createLexemeCandidate = (seed: Seed): CatalogLexemeCandidateV1 => {
  const [lemma, vietnamese, partOfSpeech] = seed;
  const identity = { language: 'en', normalizedLemma: lemma, partOfSpeech, senseKey: 'primary' };
  const example = exampleFor(lemma, vietnamese, partOfSpeech);
  const entity: LexemeV3 = {
    schemaVersion: 3,
    id: createLexemeId(identity),
    ...identity,
    lemma,
    definitions: [{ language: 'vi', text: vietnamese }],
    phonetics: [],
    examples: [{
      text: example.text,
      translations: [{ language: 'vi', text: example.translation }],
    }],
    collocations: [example.collocation],
    wordFamily: [],
    media: { audioUrl: null, imageUrl: null, imageSearchQuery: lemma },
    compatibility: {
      legacyPartOfSpeech: partOfSpeech,
      translation: vietnamese,
      explanation: `A ${partOfSpeech} included in the unreviewed English pilot.`,
      explanationTranslation: `Một ${partOfSpeech} trong pilot tiếng Anh chưa được kiểm duyệt.`,
      emoji: '',
      exampleSentence: example.text,
      exampleTranslation: example.translation,
      synonyms: [],
      antonyms: [],
      register: '',
      commonMistake: '',
    },
    provenance: {
      source: PROVENANCE.sourceRef,
      license: PROVENANCE.licenseId,
      reviewer: 'unreviewed',
      editorialStatus: 'draft',
    },
    contentVersion: 1,
    createdAt: PILOT_TIMESTAMP,
    updatedAt: PILOT_TIMESTAMP,
  };
  return { entity, provenance: PROVENANCE, review: { status: 'unreviewed' } };
};

const TRACK_DETAILS = Object.freeze({
  ielts: { legacyCategory: 'IELTS', skills: ['reading', 'writing', 'listening', 'speaking'] },
  toeic: { legacyCategory: 'TOEIC', skills: ['reading', 'listening'] },
  general: { legacyCategory: 'General', skills: ['reading', 'writing', 'listening', 'speaking'] },
} as const);

const cefrFor = (tier: PilotTier): string => ({
  foundation: 'A2', core: 'B1', advanced: 'B2-C1',
})[tier];

const createMembershipCandidate = (
  lexeme: LexemeV3,
  trackId: keyof typeof TRACK_DETAILS,
  tier: PilotTier,
  rank: number,
): CatalogMembershipCandidateV1 => {
  const details = TRACK_DETAILS[trackId];
  const identity = { trackId, lexemeId: lexeme.id };
  const entity: TrackMembershipV3 = {
    schemaVersion: 3,
    id: createTrackMembershipId(identity),
    ...identity,
    tier,
    cefrLevel: cefrFor(tier),
    topic: `${trackId}-${tier}`,
    legacyCategory: details.legacyCategory,
    skills: details.skills,
    rank,
    lessonGroup: `${trackId}-${tier}-${Math.floor((rank % 100) / 20) + 1}`,
    editorialStatus: 'draft',
    contentVersion: 1,
  };
  return { entity, provenance: PROVENANCE, review: { status: 'unreviewed' } };
};

export function createEnglishPilotCatalog(): CatalogSourceBundleV1 {
  for (const [tier, seeds] of TIER_SEEDS) {
    if (seeds.length !== 100) throw new TypeError(`${tier} pilot tier must contain exactly 100 seeds.`);
  }
  const tieredLexemes = TIER_SEEDS.flatMap(([tier, seeds]) => seeds.map(seed => ({
    tier,
    candidate: createLexemeCandidate(seed),
  })));
  const lexemes = tieredLexemes.map(item => item.candidate);
  const memberships = (Object.keys(TRACK_DETAILS) as (keyof typeof TRACK_DETAILS)[])
    .flatMap(trackId => tieredLexemes.map(({ tier, candidate }, rank) => (
      createMembershipCandidate(candidate.entity, trackId, tier, rank)
    )));

  return {
    manifest: {
      manifestVersion: 1,
      catalogId: 'english-phase3-pilot',
      contentLanguage: 'en',
      supportLanguages: ['vi'],
      lexemeFiles: ['pilot/english-lexemes.jsonl'],
      membershipFiles: ['pilot/english-memberships.jsonl'],
    },
    lexemes,
    memberships,
  };
}
