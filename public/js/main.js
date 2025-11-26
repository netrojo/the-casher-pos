// Main frontend logic for Cafe POS - Arabic Version with EGP
async function api(path, opts) {
  opts = opts || {};
  if (!opts.credentials) opts.credentials = 'same-origin';
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

let PRODUCTS = [];
let CATEGORIES = [];
let CART = [];
let pendingProduct = null;

function format(n){ return Number(n||0).toFixed(2) + ' ج.م'; }

function showError(message){
  const errorDiv = document.getElementById('posError');
  errorDiv.innerText = message;
  errorDiv.classList.remove('hidden');
  setTimeout(()=>{ errorDiv.classList.add('hidden'); }, 5000);
}

function hideError(){
  const errorDiv = document.getElementById('posError');
  errorDiv.classList.add('hidden');
}

async function init(){
  // check user
  const user = await api('/api/user').catch(()=>({}));
  const userArea = document.getElementById('userArea');
  if(user && user.user){
    const role = user.user.role === 'manager' ? 'مدير' : 'كاشير';
    userArea.innerHTML = `<span>${user.user.email} (${role})</span> <button id="logoutBtn">تسجيل الخروج</button> ${user.user.role==='manager'? '<a href="/admin.html">⚙️ إدارة</a> <a href="/orders.html">📊 تقارير</a>':''}`;
    document.getElementById('logoutBtn').addEventListener('click', ()=>api('/api/logout', { method:'POST' }).then(()=>location='/login.html'));
  } else { location = '/login.html'; return; }

  // load categories
  CATEGORIES = await api('/api/categories');
  const catSel = document.getElementById('categoryFilter');
  catSel.innerHTML = '<option value="">جميع الفئات</option>' + CATEGORIES.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');

  // load products
  await loadProducts();

  // search handlers
  document.getElementById('searchInput').addEventListener('input', ()=>renderProducts());
  document.getElementById('categoryFilter').addEventListener('change', ()=>renderProducts());

  // cart actions
  document.getElementById('clearCart').addEventListener('click', ()=>{ CART=[]; renderCart(); hideError(); });
  document.getElementById('checkoutBtn').addEventListener('click', ()=>{ 
    if(CART.length==0){ 
      showError('الطلب فارغ - من فضلك أضف منتجات قبل الدفع');
      return; 
    }
    hideError();
    document.getElementById('checkoutModal').classList.remove('hidden'); 
    updatePaymentUI(); 
  });
  document.getElementById('cancelPayment').addEventListener('click', ()=>document.getElementById('checkoutModal').classList.add('hidden'));
  document.getElementById('paymentMethod').addEventListener('change', updatePaymentUI);
  document.getElementById('cashReceived').addEventListener('input', updateChange);
  document.getElementById('confirmPayment').addEventListener('click', confirmPayment);
  
  // Quantity modal handlers
  document.getElementById('confirmQuantity').addEventListener('click', handleQuantityConfirm);
  document.getElementById('cancelQuantity').addEventListener('click', ()=>{
    document.getElementById('quantityModal').classList.add('hidden');
    document.getElementById('quantityError').classList.add('hidden');
    pendingProduct = null;
  });
  document.getElementById('quantityInput').addEventListener('keypress', (e)=>{
    if(e.key === 'Enter') handleQuantityConfirm();
  });

  document.getElementById('discount').addEventListener('input', renderCart);
}

function handleQuantityConfirm(){
  const qtyInput = document.getElementById('quantityInput').value.trim();
  const qty = parseInt(qtyInput, 10);
  const errorDiv = document.getElementById('quantityError');
  
  if(!qtyInput || isNaN(qty) || qty <= 0){
    errorDiv.innerText = 'من فضلك أدخل كمية صحيحة (أكبر من 0)';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  if(qty > 999){
    errorDiv.innerText = 'الكمية كبيرة جداً - الحد الأقصى 999';
    errorDiv.classList.remove('hidden');
    return;
  }
  
  const notes = document.getElementById('notesInput').value || '';
  addToCart({ 
    product_id: pendingProduct.id, 
    name: pendingProduct.name, 
    price: pendingProduct.price, 
    qty, 
    modifiers:'', 
    notes 
  });
  
  document.getElementById('quantityModal').classList.add('hidden');
  pendingProduct = null;
  hideError();
}

function updatePaymentUI(){ const method = document.getElementById('paymentMethod').value; document.getElementById('cashBlock').style.display = method==='نقدي' || method==='Cash' ? 'block' : 'none'; }

function updateChange(){
  const cash = parseFloat(document.getElementById('cashReceived').value)||0;
  const total = parseFloat(document.getElementById('total').innerText)||0;
  const change = cash - total;
  document.getElementById('changeGiven').innerText = change.toFixed(2) + ' ج.م';
}

async function loadProducts(){ PRODUCTS = await api('/api/products'); renderProducts(); }

function renderProducts(){
  const q = document.getElementById('searchInput').value.toLowerCase();
  const cat = document.getElementById('categoryFilter').value;
  const list = document.getElementById('productList');
  const filtered = PRODUCTS.filter(p=> (!cat || p.category_id==cat) && (!q || p.name.toLowerCase().includes(q)));
  list.innerHTML = filtered.map(p=>`<div class="product ${p.stock<5 ? 'low-stock' : ''}"><div class="name">${p.name}</div><div class="price">${p.price.toFixed(2)} ج.م</div><div class="stock">المخزون: ${p.stock}</div><div style="margin-top:8px"><button data-id="${p.id}" class="add">إضافة</button></div></div>`).join('') || '<div>لا توجد منتجات</div>';
  document.querySelectorAll('.add').forEach(b=>b.addEventListener('click', e=>{
    const id = e.target.dataset.id;
    pendingProduct = PRODUCTS.find(p=>p.id==id);
    document.getElementById('quantityInput').value = '1';
    document.getElementById('notesInput').value = '';
    document.getElementById('quantityError').classList.add('hidden');
    document.getElementById('quantityModal').classList.remove('hidden');
  }));
}

function addToCart(item){
  const existing = CART.find(i=>i.product_id==item.product_id && i.notes==item.notes);
  if(existing){ existing.qty += item.qty; } else CART.push(item);
  renderCart();
}

function calcTotals(){
  const subtotal = CART.reduce((s,i)=>s + (i.price * i.qty),0);
  const discount = parseFloat(document.getElementById('discount').value)||0;
  const tax = 0;
  const total = Math.max(0, subtotal - discount);
  return { subtotal, tax, discount, total };
}

function renderCart(){
  const el = document.getElementById('cartItems');
  el.innerHTML = CART.map((i,idx)=>`<div class="cartItem"><div>${i.name} x ${i.qty}</div><div>${(i.price*i.qty).toFixed(2)} ج.م <button data-idx="${idx}" class="remove">حذف</button></div></div>`).join('') || '<div>الطلب فارغ</div>';
  document.querySelectorAll('.remove').forEach(b=>b.addEventListener('click', e=>{ const idx = e.target.dataset.idx; CART.splice(idx,1); renderCart(); }));
  const t = calcTotals();
  document.getElementById('subtotal').innerText = t.subtotal.toFixed(2);
  document.getElementById('total').innerText = t.total.toFixed(2);
  document.getElementById('cashReceived').value = '';
  document.getElementById('changeGiven').innerText = '0.00 ج.م';
}

async function confirmPayment(){
  const method = document.getElementById('paymentMethod').value;
  const totals = calcTotals();
  const cashReceived = parseFloat(document.getElementById('cashReceived').value)||0;
  
  // Validate cash payment
  if(method === 'نقدي' || method === 'Cash'){
    if(cashReceived < totals.total){
      showError('المبلغ المدفوع أقل من إجمالي الفاتورة');
      return;
    }
  }
  
  const change = Math.max(0, cashReceived - totals.total);
  const payload = { items: CART, subtotal: totals.subtotal, tax: totals.tax, discount: totals.discount, total: totals.total, payment_method: method, cash_received: cashReceived, change_given: change };
  try{
    const resp = await api('/api/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    // show printable receipt
    const receiptHtml = buildReceipt(resp.orderId, payload);
    const w = window.open('','receipt'); w.document.write(receiptHtml); w.document.close(); w.print();
    CART = [];
    renderCart();
    document.getElementById('checkoutModal').classList.add('hidden');
    hideError();
    showError('تم إتمام الطلب بنجاح ✅');
  }catch(err){ 
    showError('فشل إتمام الطلب: '+err.message);
  }
}

function buildReceipt(orderId, payload){
  const now = new Date().toLocaleString('ar-EG');
  const itemsHtml = payload.items.map(i=>`<tr><td class="item-name">${i.name}</td><td class="item-qty">${i.qty}</td><td class="item-price">${i.price.toFixed(2)}</td><td class="item-total">${(i.price*i.qty).toFixed(2)}</td></tr>`).join('');
  const methodAr = payload.payment_method === 'Cash' || payload.payment_method === 'نقدي' ? 'نقدي' : 'بطاقة';
  const cashSection = methodAr === 'نقدي' ? `<div class="receipt-row"><span>المبلغ المستلم:</span><span>${payload.cash_received.toFixed(2)} ج.م</span></div><div class="receipt-row"><span>الباقي:</span><span>${payload.change_given.toFixed(2)} ج.م</span></div>` : '';
  
  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>إيصال #${orderId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Cairo', Arial, sans-serif;
      background: #f5f5f5;
      padding: 20px;
      direction: rtl;
    }
    .receipt-container {
      max-width: 400px;
      margin: 0 auto;
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      direction: rtl;
    }
    .receipt-header {
      text-align: center;
      border-bottom: 2px solid #333;
      padding-bottom: 15px;
      margin-bottom: 15px;
    }
    .receipt-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: #333;
      margin-bottom: 5px;
    }
    .receipt-subtitle {
      font-size: 0.9rem;
      color: #666;
      margin-bottom: 10px;
    }
    .receipt-info {
      font-size: 0.85rem;
      color: #666;
      line-height: 1.6;
      margin-bottom: 15px;
      border-bottom: 1px dashed #ccc;
      padding-bottom: 15px;
    }
    .receipt-items {
      margin-bottom: 15px;
      border-bottom: 1px dashed #ccc;
      padding-bottom: 15px;
    }
    .receipt-items table {
      width: 100%;
      font-size: 0.85rem;
      border-collapse: collapse;
    }
    .receipt-items th {
      text-align: right;
      font-weight: 700;
      padding: 8px 4px;
      border-bottom: 1px solid #ccc;
      color: #333;
    }
    .receipt-items td {
      padding: 6px 4px;
      text-align: right;
    }
    .item-name {
      font-weight: 600;
      text-align: right;
    }
    .item-qty,
    .item-price,
    .item-total {
      text-align: center;
    }
    .receipt-totals {
      margin-bottom: 15px;
      padding-bottom: 15px;
      border-bottom: 1px dashed #ccc;
    }
    .receipt-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 0.9rem;
    }
    .receipt-row span:first-child {
      text-align: right;
    }
    .receipt-row span:last-child {
      text-align: left;
      font-weight: 600;
    }
    .receipt-total {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      font-size: 1.1rem;
      font-weight: 700;
      color: #333;
      border-top: 2px solid #333;
      border-bottom: 2px solid #333;
    }
    .receipt-payment {
      margin-bottom: 15px;
      padding: 10px;
      background: #f9f9f9;
      border-radius: 4px;
      font-size: 0.85rem;
      text-align: center;
    }
    .receipt-footer {
      text-align: center;
      font-size: 0.8rem;
      color: #999;
      padding-top: 10px;
      border-top: 1px dashed #ccc;
    }
    .receipt-footer p {
      margin: 5px 0;
    }
    .print-btn {
      display: block;
      width: 100%;
      padding: 12px;
      margin-top: 20px;
      background: #6b5b95;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.3s ease;
    }
    .print-btn:hover {
      background: #4a3f6b;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .receipt-container {
        max-width: 100%;
        margin: 0;
        padding: 0;
        box-shadow: none;
        border-radius: 0;
      }
      .print-btn {
        display: none;
      }
      @page {
        size: 80mm auto;
        margin: 0;
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="receipt-container">
    <div class="receipt-header">
      <div class="receipt-title">☕ الكشافة البحرية</div>
      <div class="receipt-subtitle">Cafe POS</div>
    </div>
    
    <div class="receipt-info">
      <div>رقم الإيصال: #${orderId}</div>
      <div>التاريخ والوقت: ${now}</div>
      <div>طريقة الدفع: ${methodAr}</div>
    </div>
    
    <div class="receipt-items">
      <table>
        <thead>
          <tr>
            <th>المنتج</th>
            <th>الكمية</th>
            <th>السعر</th>
            <th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
    </div>
    
    <div class="receipt-totals">
      <div class="receipt-row">
        <span>المجموع الفرعي:</span>
        <span>${payload.subtotal.toFixed(2)} ج.م</span>
      </div>
      ${payload.discount > 0 ? `<div class="receipt-row"><span>الخصم:</span><span>-${payload.discount.toFixed(2)} ج.م</span></div>` : ''}
      <div class="receipt-total">
        <span>الإجمالي:</span>
        <span>${payload.total.toFixed(2)} ج.م</span>
      </div>
      ${cashSection}
    </div>
    
    <div class="receipt-payment">
      <strong>${methodAr === 'نقدي' ? 'دفع نقدي' : 'دفع ببطاقة'}</strong>
    </div>
    
    <div class="receipt-footer">
      <p>شكراً لزيارتك! 🙏</p>
      <p style="margin-top: 10px; font-size: 0.75rem;">نقطة البيع - نسخة 1.0</p>
    </div>
  </div>
  
  <button class="print-btn" onclick="window.print()">🖨️ طباعة الإيصال</button>
</body>
</html>`;
}

window.addEventListener('DOMContentLoaded', init);
