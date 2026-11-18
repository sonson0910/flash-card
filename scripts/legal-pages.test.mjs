import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = file => fs.readFileSync(path.resolve('public', file), 'utf8');
const section = (html, id) => new RegExp(`<section id="${id}"[^>]*>([\\s\\S]*?)</section>`).exec(html)?.[1] || '';

describe('legal pages', () => {
  it('provides complete Vietnamese and English Terms with current pilot and account guidance', () => {
    const html = read('terms.html');
    const vietnamese = section(html, 'tieng-viet');
    const english = section(html, 'english');

    expect(html).toContain('Cập nhật: 01/10/2026 · Updated: 01/10/2026');
    expect(html).toContain('<a href="#tieng-viet" hreflang="vi">');
    expect(html).toContain('<a href="#english" hreflang="en">');
    expect(html).toContain('<section id="tieng-viet" lang="vi"');
    expect(html).toContain('<section id="english" lang="en"');
    expect(vietnamese).toContain('<h1 id="terms-vi">Điều khoản sử dụng</h1>');
    expect(vietnamese).toContain('<h2>Nội dung học tập</h2>');
    expect(vietnamese).toContain('<h2>Free và Pro trong pilot</h2>');
    expect(vietnamese).toContain('<h2>Tài khoản và dữ liệu</h2>');
    expect(vietnamese).toContain('Giá cuối cùng đã gồm VAT sẽ được công bố trước khi mở bán');
    expect(vietnamese).toContain('Pilot không nhận thanh toán');
    expect(vietnamese).toContain('Đăng ký mua khi mở bán');
    expect(vietnamese).toContain('mục Dữ liệu tài khoản cho phép tải thẻ dưới dạng Excel');
    expect(vietnamese).toContain('Nếu cần hỗ trợ xuất hoặc xóa dữ liệu');
    expect(english).toContain('<h1 id="terms-en">Terms of Use</h1>');
    expect(english).toContain('<h2>Learning content</h2>');
    expect(english).toContain('<h2>Free and Pro during the pilot</h2>');
    expect(english).toContain('<h2>Account and data</h2>');
    expect(english).toContain('The final VAT-inclusive price will be announced before sales begin');
    expect(english).toContain('The pilot accepts no payments');
    expect(english).toContain('records purchase interest only');
    expect(english).toContain('Account data lets you download cards as Excel');
    expect(english).toContain('For help exporting or deleting data');
    expect(html).not.toMatch(/79[.,]?000/i);
    expect(vietnamese).toContain('href="/privacy.html">Quyền riêng tư</a>');
    expect(english).toContain('href="/privacy.html">Privacy</a>');
  });

  it('provides complete Vietnamese and English Privacy content with reciprocal and extension links', () => {
    const html = read('privacy.html');
    const vietnamese = section(html, 'tieng-viet');
    const english = section(html, 'english');

    expect(html).toContain('Cập nhật: 01/10/2026 · Updated: 01/10/2026');
    expect(html).toContain('<a href="#tieng-viet" hreflang="vi">');
    expect(html).toContain('<a href="#english" hreflang="en">');
    expect(vietnamese).toContain('<h1 id="privacy-vi">Quyền riêng tư</h1>');
    expect(vietnamese).toContain('<h2>Dữ liệu được xử lý</h2>');
    expect(vietnamese).toContain('<h2>Nhà cung cấp và nơi xử lý</h2>');
    expect(vietnamese).toContain('<h2>Đo chất lượng pilot</h2>');
    expect(vietnamese).toContain('<h2>Lưu giữ và quyền của bạn</h2>');
    expect(vietnamese).toContain('Google Gemini');
    expect(vietnamese).toContain('tối đa 180 ngày');
    expect(english).toContain('<h1 id="privacy-en">Privacy</h1>');
    expect(english).toContain('<h2>Data processed</h2>');
    expect(english).toContain('<h2>Providers and processing locations</h2>');
    expect(english).toContain('<h2>Measuring pilot quality</h2>');
    expect(english).toContain('<h2>Retention and your rights</h2>');
    expect(english).toContain('Google Gemini');
    expect(english).toContain('up to 180 days');
    expect(vietnamese).toContain('href="/terms.html">Điều khoản sử dụng</a>');
    expect(english).toContain('href="/terms.html">Terms of Use</a>');
    expect(vietnamese).toContain('href="/browser-extension-privacy.html">Quyền riêng tư của extension</a>');
    expect(english).toContain('href="/browser-extension-privacy.html">Extension privacy policy</a>');
  });
});
