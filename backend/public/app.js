// === CONFIG ===
const API = 'https://api-mega-acai.onrender.com';
let token = null;
let cart = [];

// helper
const $ = id => document.getElementById(id);

// show/hide menu & sections
function showMenu(show){
  const menu = $('menu');
  if(!menu) return;
  if(show) menu.classList.remove('hidden');
  else menu.classList.add('hidden');
}
function showSection(sectionId){
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const el = $(sectionId);
  if(el) el.classList.add('active');
}

/* Fetch wrapper */
async function fetchJSON(endpoint, options = {}){
  options.headers = options.headers || {};
  options.headers['Content-Type'] = 'application/json';
  if (token) options.headers['Authorization'] = 'Bearer ' + token;
  try {
    const res = await fetch(API + endpoint, options);
    if (!res.ok) {
      // return JSON error if any
      const txt = await res.text().catch(()=>null);
      console.error('fetch error', res.status, txt);
      return { error: txt || `HTTP ${res.status}` };
    }
    return await res.json();
  } catch (e) {
    console.error('network error', e);
    return { error: 'Falha na comunicação com o servidor' };
  }
}

/* populate helper */
function populateSelect(id, items){
  const sel = $(id);
  if(!sel) return;
  sel.innerHTML = '';
  if(!items || !Array.isArray(items)) return;
  items.forEach(i => {
    const opt = document.createElement('option');
    opt.value = i.id;
    opt.textContent = i.name + (typeof i.price === 'number' ? ` - R$${i.price.toFixed(2)}` : '');
    sel.appendChild(opt);
  });
}

/* render cart */
function renderCart(){
  const list = $('cartList');
  if(!list) return;
  list.innerHTML = '';
  let total = 0;
  cart.forEach(c => {
    const li = document.createElement('li');
    const sub = (c.price_unit || 0) * (c.qty || 1);
    total += sub;
    li.textContent = `${c.name} x${c.qty} - R$${sub.toFixed(2)}`;
    if(c.addons && c.addons.length){
      const ul = document.createElement('ul');
      c.addons.forEach(a=>{
        const s = a.price_unit * a.qty;
        total += s;
        const li2 = document.createElement('li');
        li2.textContent = `+ ${a.name} x${a.qty} - R$${s.toFixed(2)}`;
        ul.appendChild(li2);
      });
      li.appendChild(ul);
    }
    list.appendChild(li);
  });
  const delivery = parseFloat($('deliveryFee')?.value) || 0;
  total += delivery;
  if($('totalValue')) $('totalValue').textContent = total.toFixed(2);
}

/* init (load selects) */
async function init(){
  const [productsRes, addonsRes, appsRes, paymentsRes] = await Promise.all([
    fetchJSON('/products'),
    fetchJSON('/add_ons'),
    fetchJSON('/apps'),
    fetchJSON('/payment_methods')
  ]);
  if (productsRes?.error) console.warn(productsRes.error);
  populateSelect('productSelect', productsRes);
  populateSelect('addonSelect', addonsRes);
  populateSelect('appSelect', appsRes);
  populateSelect('paymentSelect', paymentsRes);
}

/* event wiring AFTER DOM loaded */
document.addEventListener('DOMContentLoaded', () => {

  // start state
  showMenu(false);
  showSection('loginSection');

  // LOGIN
  const btnLogin = $('btnLogin');
  if(btnLogin){
    btnLogin.addEventListener('click', async () => {
      const email = $('email')?.value.trim();
      const password = $('password')?.value.trim();
      if(!email || !password){
        $('loginMsg').textContent = 'Preencha e-mail e senha.';
        return;
      }
      $('loginMsg').textContent = 'Entrando...';
      const res = await fetchJSON('/auth/login', { method:'POST', body: JSON.stringify({ email, password }) });
      if(res && res.token){
        token = res.token;
        $('loginMsg').textContent = '';
        $('userArea').textContent = `${res.user.name} (${res.user.email})`;
        showMenu(true);
        showSection('pdvSection');
        await init();
      } else {
        $('loginMsg').textContent = res?.error || 'Usuário ou senha incorretos.';
      }
    });
  }

  // LOGOUT
  const btnLogout = $('btnLogout');
  if(btnLogout) btnLogout.addEventListener('click', () => {
    token = null;
    cart = [];
    renderCart();
    showMenu(false);
    showSection('loginSection');
  });

  // MENU NAV
  const btnVenda = $('btnVenda');
  if(btnVenda) btnVenda.addEventListener('click', ()=> showSection('pdvSection'));
  const btnRel = $('btnRelatorios');
  if(btnRel) btnRel.addEventListener('click', ()=> showSection('reportsSection'));
  const btnEst = $('btnEstoque');
  if(btnEst) btnEst.addEventListener('click', ()=> showSection('stockSection'));

  // ADD PRODUCT
  const addProductBtn = $('addProduct');
  if(addProductBtn) addProductBtn.addEventListener('click', async ()=>{
    const id = parseInt($('productSelect')?.value);
    const qty = parseInt($('productQty')?.value) || 1;
    if(!id) return alert('Selecione um produto');
    const prodList = await fetchJSON('/products');
    const prod = (prodList || []).find(p => p.id === id);
    if(!prod) return alert('Produto inválido');
    cart.push({ type:'product', product_id: id, name: prod.name, qty, price_unit: prod.price, addons: [] });
    renderCart();
  });

  // ADD ADDON
  const addAddonBtn = $('addAddon');
  if(addAddonBtn) addAddonBtn.addEventListener('click', async ()=>{
    const id = parseInt($('addonSelect')?.value);
    const qty = parseInt($('addonQty')?.value) || 1;
    if(!id) return alert('Selecione um adicional');
    const list = await fetchJSON('/add_ons');
    const addon = (list || []).find(a => a.id === id);
    if(!addon) return alert('Adicional inválido');
    if(cart.length > 0 && cart[cart.length-1].type === 'product'){
      cart[cart.length-1].addons.push({ addon_id: id, name: addon.name, qty, price_unit: addon.price });
    } else {
      cart.push({ type:'addon', addon_id: id, name: addon.name, qty, price_unit: addon.price });
    }
    renderCart();
  });

  // FINALIZE
  const finalizeBtn = $('finalize');
  if(finalizeBtn) finalizeBtn.addEventListener('click', async ()=>{
    if(cart.length === 0) return alert('Carrinho vazio.');
    const payload = {
      items: cart.map(c => {
        if(c.type === 'product') {
          return { product_id: c.product_id, qty: c.qty, price_unit: c.price_unit, addons: (c.addons||[]).map(a=>({ addon_id: a.addon_id, qty: a.qty, price_unit: a.price_unit })) };
        } else {
          return { product_id: null, qty: c.qty, price_unit: c.price_unit, addons: [] };
        }
      }),
      app_id: parseInt($('appSelect')?.value) || null,
      payment_method_id: parseInt($('paymentSelect')?.value) || null,
      delivery_fee: parseFloat($('deliveryFee')?.value) || 0
    };
    const res = await fetchJSON('/sales', { method:'POST', body: JSON.stringify(payload) });
    if(res && res.success){
      alert('Venda registrada — Total R$ ' + (res.total || 0).toFixed(2));
      cart = [];
      renderCart();
    } else {
      alert('Erro ao registrar venda: ' + (res?.error || 'Desconhecido'));
    }
  });

  // REPORTS
  const loadSalesBtn = $('loadSales');
  if(loadSalesBtn) loadSalesBtn.addEventListener('click', async ()=>{
    const from = $('fromDate')?.value || '';
    const to = $('toDate')?.value || '';
    const rows = await fetchJSON(`/sales?from=${from}&to=${to}`);
    const out = $('reportsOutput');
    out.innerHTML = '<h4>Vendas</h4>';
    (rows || []).forEach(r => {
      const d = document.createElement('div');
      d.textContent = `${r.date_time} - R$${(r.total||0).toFixed(2)} - ${r.app_name||''} - ${r.payment_name||''}`;
      out.appendChild(d);
    });
  });

  // TOPS
  $('loadTopProducts')?.addEventListener('click', async ()=>{
    const rows = await fetchJSON('/reports/top-products');
    const out = $('reportsOutput'); out.innerHTML = '<h4>Top Copos</h4>';
    (rows || []).forEach(r => { const d = document.createElement('div'); d.textContent = `${r.name} — ${r.qtd} vendidos`; out.appendChild(d); });
  });
  $('loadTopAddons')?.addEventListener('click', async ()=>{
    const rows = await fetchJSON('/reports/top-addons');
    const out = $('reportsOutput'); out.innerHTML = '<h4>Top Adicionais</h4>';
    (rows || []).forEach(r => { const d = document.createElement('div'); d.textContent = `${r.name} — ${r.qtd} vendidos`; out.appendChild(d); });
  });

  // STOCK
  $('stockSubmit')?.addEventListener('click', async ()=>{
    const produto = $('stockProduto')?.value?.trim();
    const tipo = $('stockTipo')?.value;
    const quantidade = parseFloat($('stockQuant')?.value) || 0;
    const valor_unitario = parseFloat($('stockValor')?.value) || null;
    const motivo = $('stockMotivo')?.value || '';
    const res = await fetchJSON('/stock/movements', { method: 'POST', body: JSON.stringify({ produto, tipo, quantidade, valor_unitario, motivo }) });
    if(res && res.success){
      alert('Movimento registrado!');
      $('stockProduto').value = '';
      $('stockQuant').value = '1';
    } else alert('Erro: ' + (res?.error||'Desconhecido'));
  });

  $('loadStock')?.addEventListener('click', async ()=>{
    const rows = await fetchJSON('/stock');
    const out = $('stockOutput'); out.innerHTML = '<h4>Saldo</h4>';
    (rows || []).forEach(r => { const d = document.createElement('div'); d.textContent = `${r.produto} — Entrada: ${r.entrada} | Saída: ${r.saida} | Saldo: ${r.saldo}`; out.appendChild(d); });
  });

}); // DOMContentLoaded
