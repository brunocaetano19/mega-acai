const API = '';
let token = null;
let cart = [];

// Helper
function $(id) { return document.getElementById(id); }

// Feedback visual tipo toast
function showMessage(msg, type='info', duration=2000){
    const container = document.createElement('div');
    container.className = `toast ${type}`;
    container.textContent = msg;
    document.body.appendChild(container);
    setTimeout(() => container.classList.add('show'), 50);
    setTimeout(() => container.classList.remove('show'), duration);
    setTimeout(() => container.remove(), duration + 300);
}

// Destacar item adicionado
function highlightItem(el){
    el.style.backgroundColor = '#ffecd9';
    setTimeout(() => el.style.backgroundColor = '', 500);
}

// Fetch com token e tratamento de erros
async function fetchJSON(url, opts={}) {
    opts.headers = opts.headers || {};
    opts.headers['Content-Type'] = 'application/json';
    if(token) opts.headers['Authorization'] = 'Bearer ' + token;
    try {
        const res = await fetch(API + url, opts);
        if(res.status === 401){ 
            showMessage('Sessão inválida. Faça login novamente.', 'error');
            location.reload();
            return; 
        }
        return await res.json();
    } catch(e){
        showMessage('Erro na comunicação com o servidor', 'error');
        console.error(e);
    }
}

// Popular selects
function populateSelect(id, items, valueField, textField){
    const sel = $(id);
    if(!sel) return;
    sel.innerHTML = '';
    items?.forEach(it => {
        const o = document.createElement('option');
        o.value = it[valueField];
        o.textContent = it[textField] + (it.price ? ` - R$${(it.price||0).toFixed(2)}` : '');
        sel.appendChild(o);
    });
}

// Inicializar selects
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

// Renderizar carrinho
function renderCart(){
    const list = $('#cartList');
    if(!list) return;
    list.innerHTML = '';
    let total = 0;

    cart.forEach(c => {
        const li = document.createElement('li');
        li.classList.add('cart-item', 'fade-in');

        if(c.type === 'product'){
            const sub = c.price_unit * c.qty;
            total += sub;
            li.textContent = `${c.name} x${c.qty} - R$${sub.toFixed(2)}`;

            if(c.addons.length > 0){
                const ul = document.createElement('ul');
                c.addons.forEach(a => {
                    const subAddon = a.price_unit * a.qty;
                    total += subAddon;
                    const li2 = document.createElement('li');
                    li2.textContent = `+ ${a.name} x${a.qty} - R$${subAddon.toFixed(2)}`;
                    ul.appendChild(li2);
                });
                li.appendChild(ul);
            }
        } else {
            const sub = c.price_unit * c.qty;
            total += sub;
            li.textContent = `${c.name} x${c.qty} - R$${sub.toFixed(2)}`;
        }

        list.appendChild(li);
    });

    total += parseFloat($('#deliveryFee')?.value) || 0;
    $('#totalValue').textContent = total.toFixed(2);
}

// DOM pronto
document.addEventListener('DOMContentLoaded', () => {

    // LOGIN
    $('#btnLogin')?.addEventListener('click', async () => {
        const email = $('#email')?.value.trim();
        const password = $('#password')?.value.trim();
        if(!email || !password){ showMessage('Preencha email e senha', 'error'); return; }

        const res = await fetchJSON('/auth/login', { method:'POST', body: JSON.stringify({ email, password }) });
        if(res?.token){
            token = res.token;
            $('#loginSection')?.classList.add('hidden');
            $('#pdvSection')?.classList.remove('hidden');
            $('#logoutBtn')?.classList.remove('hidden');
            showMessage('Login realizado com sucesso!', 'success');
            init();
        } else {
            showMessage(res?.error || 'Erro ao entrar', 'error');
        }
    });

    // LOGOUT
    $('#logoutBtn')?.addEventListener('click', () => {
        token = null;
        $('#pdvSection')?.classList.add('hidden');
        $('#loginSection')?.classList.remove('hidden');
        $('#logoutBtn')?.classList.add('hidden');
    });

    // ADICIONAR PRODUTO
    $('#addProduct')?.addEventListener('click', async () => {
        const productId = parseInt($('#productSelect')?.value);
        const qty = parseInt($('#productQty')?.value) || 1;
        if(!productId){ showMessage('Selecione um produto', 'error'); return; }

        const prod = (await fetchJSON('/products'))?.find(p => p.id === productId);
        if(!prod) { showMessage('Produto inválido', 'error'); return; }

        cart.push({ type:'product', product_id: productId, name: prod.name, qty, price_unit: prod.price, addons: [] });
        renderCart();
        showMessage(`${prod.name} adicionado ao carrinho`, 'success');
        const lastItem = $('#cartList')?.lastChild;
        if(lastItem) highlightItem(lastItem);
    });

    // ADICIONAR ADICIONAL
    $('#addAddon')?.addEventListener('click', async () => {
        const addonId = parseInt($('#addonSelect')?.value);
        const qty = parseInt($('#addonQty')?.value) || 1;
        if(!addonId){ showMessage('Selecione um adicional', 'error'); return; }

        const addon = (await fetchJSON('/add_ons'))?.find(a => a.id === addonId);
        if(!addon) { showMessage('Adicional inválido', 'error'); return; }

        if(cart.length > 0 && cart[cart.length-1].type === 'product'){
            cart[cart.length-1].addons.push({ addon_id: addonId, name: addon.name, qty, price_unit: addon.price });
        } else {
            cart.push({ type:'addon', addon_id: addonId, name: addon.name, qty, price_unit: addon.price });
        }

        renderCart();
        showMessage(`${addon.name} adicionado`, 'success');
        const lastItem = $('#cartList')?.lastChild;
        if(lastItem) highlightItem(lastItem);
    });

    // FINALIZAR VENDA
    $('#finalize')?.addEventListener('click', async ()=>{
        if(cart.length === 0){ showMessage('Carrinho vazio', 'error'); return; }

        const app_id = parseInt($('#appSelect')?.value) || null;
        const payment_method_id = parseInt($('#paymentSelect')?.value) || null;
        const delivery_fee = parseFloat($('#deliveryFee')?.value) || 0;

        const itemsPayload = cart.map(c => {
            if(c.type==='product'){
                return {
                    product_id: c.product_id,
                    qty: c.qty,
                    price_unit: c.price_unit,
                    addons: c.addons.map(a => ({ addon_id: a.addon_id, qty: a.qty, price_unit: a.price_unit }))
                };
            } else {
                return { product_id: null, qty: c.qty, price_unit: c.price_unit, addons: [] };
            }
        });

        const res = await fetchJSON('/sales', { method:'POST', body: JSON.stringify({ items: itemsPayload, delivery_fee, app_id, payment_method_id }) });
        if(res?.success){
            cart = [];
            renderCart();
            showMessage(`Venda registrada — Total R$ ${res.total?.toFixed(2)}`, 'success', 4000);
        } else {
            showMessage('Erro ao registrar venda', 'error');
        }
    });

});
