// Main frontend logic for Cafe POS
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

let PRODUCTS = [];
let CATEGORIES = [];
let CART = [];

function format(n){ return Number(n||0).toFixed(2); }

async function init(){
  // check user
  const user = await fetch('/api/user').then(r=>r.json()).catch(()=>({}));
  const userArea = document.getElementById('userArea');
  if(user && user.user){
    userArea.innerHTML = `<span>${user.user.email} (${user.user.role})</span> <button id="logoutBtn">Logout</button> ${user.user.role==='manager'? '<a href="/admin.html">Admin</a> <a href="/orders.html">Reports</a>':''}`;
    document.getElementById('logoutBtn').addEventListener('click', ()=>fetch('/api/logout',{method:'POST'}).then(()=>location='/login.html'));
  } else { location = '/login.html'; return; }

  // load categories
  CATEGORIES = await api('/api/categories');
  const catSel = document.getElementById('categoryFilter');
  catSel.innerHTML = '<option value="">All Categories</option>' + CATEGORIES.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');

  // load products
  await loadProducts();

  // search handlers
  document.getElementById('searchInput').addEventListener('input', ()=>renderProducts());
  document.getElementById('categoryFilter').addEventListener('change', ()=>renderProducts());

  // cart actions
  document.getElementById('clearCart').addEventListener('click', ()=>{ CART=[]; renderCart(); });
  document.getElementById('checkoutBtn').addEventListener('click', ()=>{ if(CART.length==0) return alert('Cart empty'); document.getElementById('checkoutModal').classList.remove('hidden'); updatePaymentUI(); });
  document.getElementById('cancelPayment').addEventListener('click', ()=>document.getElementById('checkoutModal').classList.add('hidden'));
  document.getElementById('paymentMethod').addEventListener('change', updatePaymentUI);
  document.getElementById('cashReceived').addEventListener('input', ()=>{
    const cash = parseFloat(document.getElementById('cashReceived').value)||0; const total = calcTotals().total; document.getElementById('changeGiven').innerText = format(Math.max(0,cash-total));
  });
  document.getElementById('confirmPayment').addEventListener('click', confirmPayment);

  document.getElementById('discount').addEventListener('input', renderCart);
}

function updatePaymentUI(){ const method = document.getElementById('paymentMethod').value; document.getElementById('cashBlock').style.display = method==='Cash' ? 'block' : 'none'; }

async function loadProducts(){ PRODUCTS = await api('/api/products'); renderProducts(); }

function renderProducts(){
  const q = document.getElementById('searchInput').value.toLowerCase();
  const cat = document.getElementById('categoryFilter').value;
  const list = document.getElementById('productList');
  const filtered = PRODUCTS.filter(p=> (!cat || p.category_id==cat) && (!q || p.name.toLowerCase().includes(q)));
  list.innerHTML = filtered.map(p=>`<div class="product"><div class="name">${p.name}</div><div class="price">$${format(p.price)}</div><div class="stock">Stock: ${p.stock}</div><div style="margin-top:6px"><button data-id="${p.id}" class="add">Add</button></div></div>`).join('') || '<div>No products</div>';
  document.querySelectorAll('.add').forEach(b=>b.addEventListener('click', e=>{
    const id = e.target.dataset.id; const prod = PRODUCTS.find(p=>p.id==id);
    const qty = parseInt(prompt('Quantity', '1')||'1',10);
    const notes = prompt('Modifiers / notes (optional)', '') || '';
    if(qty>0) addToCart({ product_id: prod.id, name: prod.name, price: prod.price, qty, modifiers:'', notes });
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
  const taxPercent = parseFloat(document.getElementById('taxPercent').innerText)||10;
  const tax = subtotal * taxPercent / 100;
  const total = Math.max(0, subtotal + tax - discount);
  return { subtotal, tax, discount, total };
}

function renderCart(){
  const el = document.getElementById('cartItems');
  el.innerHTML = CART.map((i,idx)=>`<div class="cartItem"><div>${i.name} x ${i.qty}</div><div>$${format(i.price*i.qty)} <button data-idx="${idx}" class="remove">Remove</button></div></div>`).join('') || '<div>Cart empty</div>';
  document.querySelectorAll('.remove').forEach(b=>b.addEventListener('click', e=>{ const idx = e.target.dataset.idx; CART.splice(idx,1); renderCart(); }));
  const t = calcTotals();
  document.getElementById('subtotal').innerText = format(t.subtotal);
  document.getElementById('taxAmt').innerText = format(t.tax);
  document.getElementById('total').innerText = format(t.total);
  document.getElementById('taxPercent').innerText = (document.getElementById('taxPercent').innerText || '10');
}

async function confirmPayment(){
  const method = document.getElementById('paymentMethod').value;
  const totals = calcTotals();
  const cashReceived = parseFloat(document.getElementById('cashReceived').value)||0;
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
  }catch(err){ alert('Checkout failed: '+err.message); }
}

function buildReceipt(orderId, payload){
  const now = new Date().toLocaleString();
  const itemsHtml = payload.items.map(i=>`<tr><td>${i.name}</td><td>${i.qty}</td><td>$${format(i.price)}</td><td>$${format(i.price*i.qty)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title><style>body{font-family:Arial;padding:12px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:6px}</style></head><body><h3>Cafe POS Receipt</h3><div>Order: #${orderId}</div><div>${now}</div><table><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>${itemsHtml}</table><div>Subtotal: $${format(payload.subtotal)}</div><div>Tax: $${format(payload.tax)}</div><div>Discount: $${format(payload.discount)}</div><div><strong>Total: $${format(payload.total)}</strong></div><div>Payment: ${payload.payment_method} ${payload.payment_method==='Cash'? ' (Cash received: $'+format(payload.cash_received)+', Change: $'+format(payload.change_given)+')':''}</div></body></html>`;
}

window.addEventListener('DOMContentLoaded', init);
