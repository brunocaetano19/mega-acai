// === CONFIGURAÇÃO ===
const API = ''; // mesmo domínio (Render)
let token = null;
let cart = [];

// === FUNÇÕES ÚTEIS ===
function $(id){ return document.getElementById(id); }

async function fetchJSON(url, opts = {}) {
    opts.headers = opts.headers || {};
    opts.headers['Content-Type'] = 'application/json';
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;

    try {
        const res = await fetch(API + url, opts);
        if (!res.ok) {
            if (res.status === 401) {
                alert('Sessão inválida. Faça login novamente.');
                location.reload();
                return;
            }
            const text = await res.text();
            throw new Error(text || 'Erro desconhecido');
        }
        return await res.json();
    } catch (e) {
        console.error('Erro ao conectar com servidor:', e);
        alert('Erro ao conectar com o servidor. Verifique sua conexão.');
        return null;
    }
}

// === LOGIN ===
$('btnLogin').addEventListener('click', async ()=>{
    const email = $('email').value.trim();
    const password = $('password').value.trim();

    if(!email || !password){
        $('loginMsg').textContent = 'Preencha e-mail e senha.';
        return;
    }

    $('loginMsg').textContent = 'Entrando...';

    const res = await fetchJSON('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });

    if(res && res.token){
        token = res.token;
        $('loginSection').classList.add('hidden');
        $('pdvSection').classList.remove('hidden');
        $('reportsSection').classList.remove('hidden');
        $('stockSection').classList.remove('hidden');
        $('userArea').textContent = `${res.user.name} (${res.user.email})`;
        init();
    } else {
        $('loginMsg').textContent = res?.error || 'Erro ao entrar. Verifique usuário e senha.';
    }
});

// === INICIALIZAÇÃO ===
async function init(){
    const [products, addons, apps, payments] = await Promise.all([
        fetchJSON('/products'),
        fetchJSON('/add_ons'),
        fetchJSON('/apps'),
        fetchJSON('/payment_methods')
    ]);

    populateSelect('productSelect', products, 'id', 'name');
    populateSelect('addonSelect', addons, 'id', 'name');
    populateSelect('appSelect', apps, 'id', 'name');
    populateSelect('paymentSelect', payments, 'id', 'name');
}

function populateSelect(id, items, valueField, textField){
    const sel = $(id);
    sel.innerHTML = '';
    if(!items) return;
    items.forEach(it=>{
        const o = document.createElement('option');
        o.value = it[valueField];
        o.textContent = it[textField] + (it.price ? (' - R$' + (it.price||0).toFixed(2)) : '');
        sel.appendChild(o);
    });
}

// === ADICIONAR PRODUTO ===
$('addProduct').addEventListener('click', async ()=>{
    const sel = $('productSelect');
    const productId = parseInt(sel.value);
    const qty = parseInt($('productQty').value) || 1;
    const products = await fetchJSON('/products');
    const prod = products.find(p=>p.id===productId);
    if(!prod) return alert('Produto inválido');

    cart.push({ 
        type: 'product',
        product_id: productId,
        name: prod.name,
        qty,
        price_unit: prod.price,
        addons: []
    });
    renderCart();
});

// === ADICIONAR ADICIONAL ===
$('addAddon').addEventListener('click', async ()=>{
    const sel = $('addonSelect');
    const addonId = parseInt(sel.value);
    const qty = parseInt($('addonQty').value) || 1;
    const addons = await fetchJSON('/add_ons');
    const addon = addons.find(a=>a.id===addonId);
    if(!addon) return alert('Adicional inválido');

    if(cart.length>0 && cart[cart.length-1].type==='product'){
        cart[cart.length-1].addons.push({
            addon_id: addonId,
            name: addon.name,
            qty,
            price_unit: addon.price
        });
    } else {
        cart.push({
            type: 'addon',
            addon_id: addonId,
            name: addon.name,
            qty,
            price_unit: addon.price
        });
    }
    renderCart();
});

// === RENDER CARRINHO ===
function renderCart(){
    const list = $('cartList');
    list.innerHTML = '';
    let total = 0;

    cart.forEach((c)=>{
        const li = document.createElement('li');
        const sub = c.price_unit * c.qty;
        total += sub;
        li.textContent = `${c.name} x${c.qty} - R$${sub.toFixed(2)}`;

        if(c.addons && c.addons.length>0){
            const ul = document.createElement('ul');
            c.addons.forEach(a=>{
                const las = a.price_unit * a.qty;
                total += las;
                const li2 = document.createElement('li');
                li2.textContent = `+ ${a.name} x${a.qty} - R$${las.toFixed(2)}`;
                ul.appendChild(li2);
            });
            li.appendChild(ul);
        }
        list.appendChild(li);
    });

    const delivery = parseFloat($('deliveryFee').value) || 0;
    total += delivery;
    $('totalValue').textContent = total.toFixed(2);
}

// === FINALIZAR VENDA ===
$('finalize').addEventListener('click', async ()=>{
    if(cart.length===0){
        alert('Carrinho vazio.');
        return;
    }

    const app_id = parseInt($('appSelect').value) || null;
    const payment_method_id = parseInt($('paymentSelect').value) || null;
    const delivery_fee = parseFloat($('deliveryFee').value) || 0;

    const itemsPayload = cart.map(c => ({
        product_id: c.product_id || null,
        qty: c.qty,
        price_unit: c.price_unit,
        addons: c.addons?.map(a=>({
            addon_id: a.addon_id,
            qty: a.qty,
            price_unit: a.price_unit
        })) || []
    }));

    const res = await fetchJSON('/sales', {
        method: 'POST',
        body: JSON.stringify({ items: itemsPayload, delivery_fee, app_id, payment_method_id })
    });

    if(res && res.success){
        alert('Venda registrada — Total R$ ' + res.total.toFixed(2));
        cart = [];
        renderCart();
    } else {
        alert('Erro ao registrar venda: ' + (res?.error || 'Desconhecido'));
    }
});

// === RELATÓRIOS ===
$('loadSales').addEventListener('click', async ()=>{
    const from = $('fromDate').value || '';
    const to = $('toDate').value || '';
    const rows = await fetchJSON(`/sales?from=${from}&to=${to}`);
    const out = $('reportsOutput');
    out.innerHTML = '<h4>Vendas</h4>';
    rows?.forEach(r=>{
        const d = document.createElement('div');
        d.textContent = `${r.date_time} - R$${r.total.toFixed(2)} - ${r.app_name||''} - ${r.payment_name||''}`;
        out.appendChild(d);
    });
});

$('loadTopProducts').addEventListener('click', async ()=>{
    const from = $('fromDate').value || '';
    const to = $('toDate').value || '';
    const rows = await fetchJSON(`/reports/top-products?from=${from}&to=${to}`);
    const out = $('reportsOutput');
    out.innerHTML = '<h4>Top Copos</h4>';
    rows?.forEach(r=>{
        const d = document.createElement('div');
        d.textContent = `${r.name} — ${r.qtd} vendidos`;
        out.appendChild(d);
    });
});

$('loadTopAddons').addEventListener('click', async ()=>{
    const from = $('fromDate').value || '';
    const to = $('toDate').value || '';
    const rows = await fetchJSON(`/reports/top-addons?from=${from}&to=${to}`);
    const out = $('reportsOutput');
    out.innerHTML = '<h4>Top Adicionais</h4>';
    rows?.forEach(r=>{
        const d = document.createElement('div');
        d.textContent = `${r.name} — ${r.qtd} vendidos`;
        out.appendChild(d);
    });
});

// === ESTOQUE ===
$('stockSubmit').addEventListener('click', async ()=>{
    const produto = $('stockProduto').value.trim();
    const tipo = $('stockTipo').value;
    const quantidade = parseFloat($('stockQuant').value) || 0;
    const valor_unitario = parseFloat($('stockValor').value) || null;
    const motivo = $('stockMotivo').value || '';

    const res = await fetchJSON('/stock/movements', {
        method:'POST',
        body: JSON.stringify({ produto, tipo, quantidade, valor_unitario, motivo })
    });

    if(res && res.success){
        alert('Movimento registrado!');
        $('stockProduto').value = '';
        $('stockQuant').value = '1';
        $('stockValor').value = '';
        $('stockMotivo').value = '';
    } else {
        alert('Erro ao registrar movimento: ' + (res?.error || 'Desconhecido'));
    }
});

$('loadStock').addEventListener('click', async ()=>{
    const rows = await fetchJSON('/stock');
    const out = $('stockOutput');
    out.innerHTML = '<h4>Saldo de Estoque</h4>';
    rows?.forEach(r=>{
        const d = document.createElement('div');
        d.textContent = `${r.produto} — Entrada: ${r.entrada} | Saída: ${r.saida} | Saldo: ${r.saldo}`;
        out.appendChild(d);
    });
});
function liberarMenu() {
    document.getElementById('btnVenda').classList.remove('hidden');
    document.getElementById('btnRelatorios').classList.remove('hidden');
    document.getElementById('btnEstoque').classList.remove('hidden');
}
