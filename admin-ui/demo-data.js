// ═══════════════════════════════════════════════════════════════════
//  AIECOS Social CRM — Demo Data
//  Synthetic dataset for instant demo without Supabase setup.
//  Loaded automatically when no Supabase config detected.
// ═══════════════════════════════════════════════════════════════════

window.DEMO_DATA = (function() {
  const now = Date.now();
  const ms = (days) => new Date(now - days * 86400000).toISOString();
  const msHour = (days, hours) => new Date(now - days * 86400000 - hours * 3600000).toISOString();

  const pages = [
    { id: 'demo_fb_001', name: 'AIECOS Demo Shop', type: 'facebook', total_conversations: 6, total_messages: 142, is_active: true },
    { id: 'demo_zl_001', name: 'AIECOS Zalo Care', type: 'zalo_oa', total_conversations: 4, total_messages: 87, is_active: true },
  ];

  // 10 partners across 5 stages
  const customers = [
    // Active (≤ 3d)
    { id: 'demo_fb_001_Shop_Alpha', name: 'Shop Alpha (HCM)', page_id: 'demo_fb_001', last_seen_at: msHour(0, 2), first_seen_at: ms(90) },
    { id: 'demo_fb_001_Shop_Beta', name: 'Shop Beta (Da Nang)', page_id: 'demo_fb_001', last_seen_at: msHour(1, 5), first_seen_at: ms(60) },
    { id: 'demo_zl_001_Mr_Quang', name: 'Mr. Quang (retail)', page_id: 'demo_zl_001', last_seen_at: msHour(2, 0), first_seen_at: ms(45) },
    // Sleeping (3-7d)
    { id: 'demo_fb_001_Shop_Delta', name: 'Shop Delta (Hue)', page_id: 'demo_fb_001', last_seen_at: ms(4), first_seen_at: ms(120) },
    { id: 'demo_zl_001_Ms_Lan', name: 'Ms. Lan (B2C)', page_id: 'demo_zl_001', last_seen_at: ms(6), first_seen_at: ms(30) },
    // At-Risk (7-30d)
    { id: 'demo_fb_001_Shop_Gamma', name: 'Shop Gamma (Hanoi)', page_id: 'demo_fb_001', last_seen_at: ms(12), first_seen_at: ms(180) },
    { id: 'demo_zl_001_Mr_Hung', name: 'Mr. Hung (wholesale)', page_id: 'demo_zl_001', last_seen_at: ms(22), first_seen_at: ms(150) },
    // Dormant (30-90d)
    { id: 'demo_fb_001_Shop_Epsilon', name: 'Shop Epsilon (Hai Phong)', page_id: 'demo_fb_001', last_seen_at: ms(45), first_seen_at: ms(200) },
    { id: 'demo_fb_001_Shop_Zeta', name: 'Shop Zeta (Vung Tau)', page_id: 'demo_fb_001', last_seen_at: ms(70), first_seen_at: ms(220) },
    // Churned (>90d)
    { id: 'demo_zl_001_Old_Client', name: 'Old Client (HCM)', page_id: 'demo_zl_001', last_seen_at: ms(120), first_seen_at: ms(300) },
  ];

  // Conversations (1 per customer)
  const conversations = customers.map(c => ({
    id: c.page_id + '__' + c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    page_id: c.page_id,
    customer_id: c.id,
    customer_name: c.name,
    snippet: 'Sample conversation...',
    updated_at: c.last_seen_at,
  }));

  // Generate ~230 realistic messages distributed across partners
  const TEMPLATES_CUSTOMER = [
    'Còn size M không em?',
    'Cho mình hỏi giá tròng cận',
    'Bên em có chuyến giao hàng lúc nào?',
    'Lấy giúp anh 3 cái nhé',
    'Mua combo 5 cái có giảm không em?',
    'Đợt tới mình sẽ nhập thêm 100 cái',
    'Đã nhận được hàng, cảm ơn shop',
    'Bao giờ giao được vậy em?',
    'Có sản phẩm mới không em?',
    'Mã đơn hàng của mình là gì?',
    'Tạm thời mình không cần thêm nữa, cảm ơn em',
    '@AIECOS Care đơn hôm qua đã gửi chưa?',
    'Bên em còn hàng tồn không?',
    'Cho check giá lẻ với em',
    'Đặt 2 cái size L, gửi quận 3',
  ];
  const TEMPLATES_AGENT = [
    'Dạ em nhận đơn ạ',
    'Dạ em gửi hóa đơn online ạ',
    'Dạ em báo kế toán xác nhận ạ',
    'Còn ạ, bên em còn size M màu đen',
    'Dạ em gửi xe 5 chuyến chiều nay ạ',
    'Cảm ơn anh/chị đã ủng hộ shop ạ',
    'Em báo bộ phận giao hàng ngay ạ',
    'Dạ anh/chị check kho hàng giúp em ạ',
    'Bên em chuyên tròng kính, cần báo giá cụ thể ạ',
    'Dạ giá hiện tại bên em là [theo bảng giá]',
  ];

  const messages = [];
  let msgIdx = 0;

  customers.forEach((c) => {
    const baseDays = c._isActive ? 2 : (c.last_seen_at ? (now - new Date(c.last_seen_at).getTime()) / 86400000 : 1);
    const lastSeenMs = new Date(c.last_seen_at).getTime();
    // Number of msgs depends on stage
    const msgCount = c.last_seen_at && (now - lastSeenMs) / 86400000 < 7 ? 25 :
                     (now - lastSeenMs) / 86400000 < 30 ? 18 :
                     (now - lastSeenMs) / 86400000 < 90 ? 12 : 8;
    for (let i = 0; i < msgCount; i++) {
      const isCustomer = Math.random() < 0.7; // 70% customer / 30% agent
      const templates = isCustomer ? TEMPLATES_CUSTOMER : TEMPLATES_AGENT;
      const content = templates[Math.floor(Math.random() * templates.length)];
      // Spread msgs over period: oldest = first_seen, newest = last_seen
      const spreadMs = lastSeenMs - i * Math.max(3600000, (lastSeenMs - new Date(c.first_seen_at).getTime()) / msgCount);
      messages.push({
        id: 'demo_msg_' + (++msgIdx),
        conversation_id: c.page_id + '__' + c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
        page_id: c.page_id,
        sender_type: isCustomer ? 'customer' : 'agent',
        sender_name: isCustomer ? c.name : (c.page_id === 'demo_fb_001' ? 'AIECOS Demo Shop' : 'AIECOS Zalo Care'),
        content,
        created_time: new Date(spreadMs).toISOString(),
      });
    }
  });

  // Sort messages by created_time DESC (newest first — matches REST default)
  messages.sort((a, b) => new Date(b.created_time).getTime() - new Date(a.created_time).getTime());

  return { pages, customers, conversations, messages };
})();
