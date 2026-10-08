/**
 * Server-rendered PHP pages. Static HTML/CSS was extracted verbatim from the
 * PHP files into templates/; only the PHP-generated parts are built here.
 * Values are interpolated unescaped, exactly as `<?= $x ?>` did.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { query } from '@/lib/db';
import { img_url, ADMIN_LOGIN } from '@/lib/config';
import { appPath, readJson } from '@/lib/files';
import {
  eventlist, gamelist, planlist, payment_history_list, user_list, user_device_list,
  display_hidden_email, display_hidden_values,
} from '@/lib/functions';
import { getSession } from '@/lib/session';
import { type PhpRequest, respond, HTML } from '@/lib/http';
import { date, dateOf, empty, htmlspecialchars, looseEq, toStr, ucwords, urlencode } from '@/lib/php';

const cache = new Map<string, string>();
async function tpl(name: string): Promise<string> {
  if (!cache.has(name)) cache.set(name, await fs.readFile(path.join(process.cwd(), 'templates', name), 'utf8'));
  return cache.get(name)!;
}

const s = toStr;

// ---------------------------------------------------------------------------
// friendship_tree_print.php
// ---------------------------------------------------------------------------

const TREE_POSITIONS = [
  ['54%', '77%'], ['51%', '10%'], ['75%', '22%'], ['42%', '24%'], ['14%', '71%'], ['75%', '35%'],
  ['30%', '33%'], ['19%', '20%'], ['72%', '80%'], ['36%', '72%'], ['40%', '87%'], ['25%', '60%'],
  ['25%', '82%'], ['45%', '50%'], ['10%', '32%'], ['34%', '13%'], ['60%', '25%'], ['23%', '45%'],
  ['59%', '88%'], ['5%', '45%'], ['67%', '12%'], ['7%', '59%'], ['70%', '65%'], ['25%', '55%'],
  ['55%', '40%'],
];

/** Shared header values from eventlist('10'). */
async function treeEvent() {
  const ev = (await eventlist('10'))[0];
  const v = (k: string) => (ev && ev[k] !== undefined && ev[k] !== null && s(ev[k]) !== '' ? s(ev[k]) : '');
  return { ev, v };
}

export async function friendshipTreePrint(): Promise<Response> {
  const { v } = await treeEvent();
  const topRightLogo = 'friendship_tree/assets/img/kas_logo.1200x0.jpeg';
  const bottomLeftLogo = v('bottom_left_logo') ? '/' + v('bottom_left_logo') : '';
  const bottomRightLogo = v('bottom_right_logo') ? '/' + v('bottom_right_logo') : '';
  const topLeftLogo = v('top_left_logo') ? '/' + v('top_left_logo') : '';
  const title = v('game_title') || 'Friendship Tree';
  const tagLine = v('tag_line');
  const location = v('game_location');

  const { rows } = await query("SELECT * FROM tblfriendship_tree WHERE status='1' ORDER BY id ASC");
  let body = '';
  if (rows.length > 0) {
    body += '    <div class="header">\n';
    if (topLeftLogo) body += `            <div class="top-left-logo"><img width="120" src="${img_url}/${topLeftLogo}" alt="Left Logo"></div>\n`;
    body += `            <div class="top-right-logo"><img width="120" src="${topRightLogo}" alt="Right Logo"></div>\n`;
    body += '\n        <div class="top-center">\n';
    if (tagLine) body += `            <h4>${tagLine}</h4>`;
    body += `\n            <div class="title">${title}</div>`;
    if (location) body += `\n            <p> ${location}</p>`;
    body += '\n        </div>\n    </div>\n\n    <div class="friends_list">\n        <div class="tree">\n';
    rows.forEach((row, k) => {
      const image = s(row.user_image) !== '' ? s(row.user_image) : '/friendship-tree/assets/img/emoji1.png';
      const [top, left] = TREE_POSITIONS[k] ?? ['50%', '50%'];
      body += `                    <div class="photo-frame" style="top:${top}; left:${left};">
                        <div class="circle-frame">
                            <img src="/app_playtown/friendship_tree/assets/img/circle-frame.png" class="frame-image">
                            <img src="${image}" class="inner-image">
                        </div>
                    </div>
`;
    });
    body += '        </div>\n    </div>\n\n';
    if (bottomLeftLogo) body += '        <div class="bottom-left-logo"><img width="120" src="assets/img/cropped-mediapointlogo.png" alt="Bottom Left Logo"></div>\n';
    body += '          <div class="bottom-link">\n    <a href="https://mediapointevent.com/">https://mediapointevent.com/</a>\n</div>\n\n\n';
    if (bottomRightLogo) body += `        <div class="bottom-right-logo"><img width="120" src="${img_url}/${bottomRightLogo}" alt="Bottom Right Logo"></div>\n`;
  }
  return respond((await tpl('friendship_tree_print.head.html')) + body + (await tpl('friendship_tree_print.tail.html')), HTML);
}

// ---------------------------------------------------------------------------
// friendshiptreepringpotrait.php
// ---------------------------------------------------------------------------

const PORTRAIT_POSITIONS: [number, number][] = [
  [348, 521], [285, 71], [496, 128], [281, 189], [111, 606], [502, 239], [206, 279], [125, 204], [502, 727],
  [321, 646], [284, 742], [234, 588], [185, 686], [300, 406], [79, 301], [185, 120], [390, 179], [164, 385],
  [391, 747], [54, 401], [404, 55], [72, 508], [435, 625], [177, 493], [376, 300], [553, 301],
];

export async function friendshipTreePortraitPrint(): Promise<Response> {
  const { ev, v } = await treeEvent();
  const topRightLogo = 'friendship_tree/assets/img/kas_logo.1200x0.jpeg';
  const bottomRightLogo = v('bottom_right_logo') ? '/' + v('bottom_right_logo') : '';
  const topLeftLogo = v('top_left_logo') ? '/' + v('top_left_logo') : '';
  const title = v('game_title');
  const tagLine = v('tag_line');
  const eventDate = ev && s(ev.date) !== '' ? dateOf('d-m-Y', ev.date) : '';
  const location = v('game_location');

  const all = await query("SELECT * FROM tblfriendship_tree where status='1'");
  const count = all.rows.length;
  let body = '';
  if (count > 0) {
    body += `        <table>
            <thead>
                <tr>
                    <th>
                        <div class="header">
                            <img src="friendship-tree/assets/friendship_tree_bgimage.png" class="bgVideo" />
`;
    if (topLeftLogo) body += `                                <div class="top-left-logo">\n                                    <img width="150" src="${img_url}/${topLeftLogo}" alt="Left Logo" >\n                                </div>\n`;
    body += '                            \n                            <div class="top-center">\n';
    if (tagLine) body += `                                    <h4>${tagLine}</h4> \n`;
    if (title) body += `                                  <div class="title">${title}</div>`;
    body += `\n                                    <p style="color: #333;">${eventDate}, ${location}</p>\n`;
    body += `                            </div>
                            <div class="qr-code" id="qrcode" >
                                <img width="150" src="${topRightLogo}" alt="topright">
                            </div>
                        </div>
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>
`;
    const loadlimit = 25;
    let pages = count > loadlimit ? Math.floor(count / loadlimit) : 1;
    pages = count > pages * loadlimit ? pages + 1 : pages;
    let start = 0;
    for (let i = 1; i <= pages; i++) {
      body += `                        <div id="page_content${i}" class="no-page-break" style="padding-left: 250px;">
                            <div class="container" class="content">
                                <div class="eventcontainer">
                                </div>

                                <div class="friends_list">
                                    <div class="tree">
`;
      const { rows } = await query(`SELECT * FROM tblfriendship_tree where status='1' order by id asc LIMIT ${loadlimit} OFFSET ${start}`);
      if (rows.length > 0) {
        body += `                                            <div class="tree1" id="friendshipTree${i}">\n`;
        rows.forEach((row, k) => {
          const [top, left] = PORTRAIT_POSITIONS[k] ?? PORTRAIT_POSITIONS[PORTRAIT_POSITIONS.length - 1];
          const image = s(row.user_image) !== '' ? s(row.user_image) : '/friendship-tree/assets/img/emoji1.png';
          body += `                                                <div class="node photo-frame" style="left: ${left}px; top: ${top}px;" id="${s(row.id)}" node-id="${k}"><div class="circle-frame"><img src="/app_playtown/friendship_tree/assets/img/circle-frame.png" class="frame-image"><img src="${image}" class="inner-image"></div></div>\n`;
        });
        body += '                                            </div> \n';
      }
      body += `                                    </div>
                                </div>
                            </div>
                        </div>

`;
      start += 25;
    }
    body += `                    </td>
                </tr>
            </tbody>
            <tfoot style="clear: both; position: relative; height: 150px; bottom: 5px;">
                <tr>
                    <td>
                        <div class="footer">
`;
    if (bottomRightLogo) body += `                                <div class="bottom-right-logo" >\n                                    <img width="150"  src="${img_url}/${bottomRightLogo}" alt="Logo">\n                                </div>\n`;
    body += `                            <div class="bottom-center">
                            </div>
                        </div>
                    </td>
                </tr>
            </tfoot>
        </table>
`;
  }
  return respond((await tpl('friendshiptreepringpotrait.head.html')) + body + (await tpl('friendshiptreepringpotrait.tail.html')), HTML);
}

// ---------------------------------------------------------------------------
// admin/wall_of_wishes_print.php
// ---------------------------------------------------------------------------

export async function wallOfWishesPrint(): Promise<Response> {
  const webUrl = '../assets/img';
  const events: any = await readJson(appPath('assets/json/event_game_json.json'));
  const ev = events && typeof events === 'object' ? events.wall_of_wishes ?? null : null;
  const get = (k: string) => (ev && !empty(ev[k]) ? ev[k] : null);
  const logo = (k: string) => (get(k) ? webUrl + '/' + s(get(k)) : '');
  const topLeftLogo = logo('top_left_logo');
  const bottomLeftLogo = logo('bottom_left_logo');
  const bottomRightLogo = logo('bottom_right_logo');
  const title = get('game_title') ? s(get('game_title')) : '';
  const tagLine = get('tag_line') ? s(get('tag_line')) : '';
  const eventDate = get('game_date') ? dateOf('d-m-Y', get('game_date')) : '';
  const location = get('game_location') ? s(get('game_location')) : '';

  const raw: any = await readJson(appPath('assets/json/wall_of_wishes.json'));
  const list = (Array.isArray(raw) ? raw : Object.values(raw ?? {})).filter(
    (it: any) => it && (it.updated_success === '1' || it.updated_success === 1),
  );

  let body = '';
  if (list.length > 0) {
    body += `  <table>
    <thead>
      <tr>
        <th>
            <div class="header">
                <video autoplay muted loop id="bgVideo">
                    <source src="../wall_of_wishes/assets/videos/wishes-bg.mp4" type="video/mp4">
                    Your browser does not support HTML5 video.
                </video>
`;
    if (topLeftLogo) body += `                    <div id="top-left-logo">\n                        <img width="150" src="${topLeftLogo}" alt="Left Logo" id="top_left_logo">\n                    </div>\n`;
    body += '                \n                <div id="top-center">\n';
    if (tagLine) body += `                    <h2 id="tag_line">${tagLine}</h2>`;
    if (title) body += `\n                    <div class="title"  id="game_title">${title}</div>`;
    if (location) body += `\n                    <p style="margin: 10px;" id="game_location">${location}</p>`;
    if (eventDate) body += `\n                    <p style="margin: 10px;" id="game_date">${eventDate}</p>`;
    body += `
                </div>


                <div id="bottom-center">
                    <h4>#LevelUpUrEvent &nbsp; &nbsp; #GameOnPlaytown</h4>
                </div>

                <div class="qr-code qr" >
                    <h4 style="text-align: center; font-size: 16px; margin: 5px 0px;">Scan , Click,<br>Text  & Share</h4>
                    <img width="150" src="../wall_of_wishes/assets/img/Wishes4ShriBajaj.png">
                </div>
            </div>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
`;
    const perPage = 3;
    const pages = Math.ceil(list.length / perPage);
    let k = 0;
    for (let i = 1; i <= pages; i++) {
      body += `          <div id="page_content${i}" class="no-page-break">\n            <div class="container walls_list">\n`;
      for (const wall of list.slice((i - 1) * perPage, i * perPage)) {
        const img = `<img class="user-img" src="${'../' + s(wall.user_image)}">`;
        const quote = `<div class="user-quote-container">
                      <img class="quote-icon" width="40" src="../wall_of_wishes/assets/img/left-quote-com.svg">
                      <div class="quote-text">
                        <h3>${s(wall.user_description)}</h3>
                        <h4 style="text-align: right;">- ${s(wall.user_name)}</h4>
                      </div>
                    </div>`;
        body += k % 2 === 0
          ? `                  <div class="commment-bar right-to-left" id="${k}">\n                    ${img}\n                    ${quote}\n                  </div>\n`
          : `                  <div class="commment-bar left-to-right" id="${k}">\n                    ${quote}\n                    ${img}\n                  </div>\n`;
        k++;
      }
      body += '            </div>\n          </div>\n';
    }
    body += `        </td>
      </tr>
    </tbody>
    <tfoot style="clear: both; position: relative; height: 150px;">
      <tr>
        <td>
          <div class="footer">
`;
    if (bottomLeftLogo) body += `              <div class="bottom-left-logo">\n                <img width="150" src="${bottomLeftLogo}" alt="Left Logo">\n              </div>\n`;
    if (bottomRightLogo) body += `              <div class="bottom-right-logo">\n                <img width="150" src="${bottomRightLogo}" alt="Right Logo">\n              </div>\n`;
    body += '          </div>\n        </td>\n      </tr>\n    </tfoot>\n  </table>\n';
  }
  return respond((await tpl('wall_of_wishes_print.head.html')) + body + (await tpl('wall_of_wishes_print.tail.html')), HTML);
}

// ---------------------------------------------------------------------------
// virtual_wish_pod/*print.php – read the live JSON from playtown.co.in
// ---------------------------------------------------------------------------

async function virtualWishPodFriends(): Promise<any[]> {
  const res = await fetch('https://playtown.co.in/app_playtown/assets/json/virtual_wish_pod.json');
  const data = res.ok ? JSON.parse(await res.text()) : null;
  if (data === null || typeof data !== 'object') {
    throw new TypeError('array_filter(): Argument #1 ($array) must be of type array');
  }
  return Object.values<any>(data).filter((f) => looseEq(f?.status, 1));
}

function wishCards(friends: any[], perPage: number, open: string, card: (f: any, index: number) => string): string {
  if (friends.length === 0) return '        <p style="text-align: center; margin-top: 100px;">No data available</p>\n';
  let html = '';
  const pages = Math.ceil(friends.length / perPage);
  for (let i = 1; i <= pages; i++) {
    html += `            <div class="${open}">\n`;
    friends.slice((i - 1) * perPage, i * perPage).forEach((f, index) => (html += card(f, index)));
    html += '            </div>\n';
  }
  return html;
}

const PASTELS = ['#b3e9f5', '#efbbc2', '#bcd5ca', '#adcbeb', '#9ec3dd', '#d9a8ce', '#ffabab', '#ebd2c5', '#baaaeb', '#f9beb1'];

function cardHtml(f: any, style: string): string {
  const image = !empty(f.user_image) ? s(f.user_image) : 'default.png';
  return `                    <div class="card" style="${style}">
                        <div class="card-header">
                            <img src="https://playtown.co.in/app_playtown/${image}"
                                 alt="${s(f.user_name)}" class="profile-pic">
                        </div>
                        <div class="card-content">
                            <h4 class="user-name">${s(f.user_name)}</h4>
                            <p class="user-role">${!empty(f.user_designation) ? s(f.user_designation) : 'Employee'}</p>
                            <p class="user-message">"${!empty(f.user_description) ? s(f.user_description) : ''}"</p>
                        </div>
                    </div>
`;
}

export async function selfiesplashPrint(): Promise<Response> {
  const friends = await virtualWishPodFriends();
  const body = wishCards(friends, 18, 'tree no-page-break', (f, i) => cardHtml(f, `background-color: ${PASTELS[i % PASTELS.length]};`));
  return respond((await tpl('selfiesplash_print.head.html')) + body + (await tpl('selfiesplash_print.tail.html')), HTML);
}

export async function virtualPrint(): Promise<Response> {
  const friends = await virtualWishPodFriends();
  const body = wishCards(friends, 18, 'grid-container', (f, i) => cardHtml(f, `background-color: ${PASTELS[i % PASTELS.length]};`));
  return respond((await tpl('virtualprint.head.html')) + body + (await tpl('virtualprint.tail.html')), HTML);
}

export async function virtualWishPodPrint(): Promise<Response> {
  const friends = await virtualWishPodFriends();
  const colors = ['#b9ace5', '#FFD700', '#ADD8E6', '#90EE90', '#FFA07A', '#DDA0DD', '#7FFFD4', '#F08080'];
  const shapes = ['border-radius: 15px;', 'border-radius: 50%;', 'border-radius: 0;', 'clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);'];
  const body = wishCards(friends, 18, 'grid-container', (f, i) => cardHtml(f, `background-color: ${colors[i % colors.length]}; ${shapes[i % shapes.length]}`));
  const html = (await tpl('virtualwishpod_print.head.html'))
    + '    <!--    <div class="title" id="game_title">Portfolio Annual Fest 2024</div>-->\n'
    + (await tpl('virtualwishpod_print.head2.html'))
    + body
    + (await tpl('virtualwishpod_print.tail.html'));
  return respond(html, HTML);
}

// ---------------------------------------------------------------------------
// app_ui/*.php
// ---------------------------------------------------------------------------

async function appUiHeader(currentPage: string) {
  const games = await gamelist();
  const plans = await planlist();
  const history = await payment_history_list();
  const session = await getSession();
  const users = session.id !== undefined && s(session.id) !== '' ? await user_list(session.id) : null;
  const active = (p: string) => (currentPage === p ? 'active' : '');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Playtown</title>
    <link rel="stylesheet" href="assets/css/style.css">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
</head>
<body>
         <div class="sidebar">
        <ul class="menu">
            <li class="menu-item ${active('home.php')}">
                <a href="home.php"><i class="fas fa-home" style="font-size: 22px;"></i>Home</a>
            </li>
            <li class="menu-item ${active('profile.php')}">
                <a href="profile.php"><i class="fas fa-user" style="font-size: 22px;"></i>Profile</a>
            </li>
            <li class="menu-item ${active('payment.php')}">
                <a href="payment.php"><i class="fas fa-credit-card" style="font-size: 22px;"></i>Payment</a>
            </li>
            <li class="menu-item ${active('tutorial.php')}">
                <a href="tutorial.php"><i class="fas fa-book" style="font-size: 22px;"></i>Tutorial</a>
            </li>
        </ul>
    </div>
    <div class="main-content">
        <div class="header">
            <div >
                <img src="assets/img/playtown-logo.png" width="150px">
            </div>
        </div>`;
  return { html, games, plans, history, session, users };
}

const APP_UI_FOOTER = `</div>
    <script src="assets/js/jquery-3.6.0.min.js" type="text/javascript"></script>
    <script src="assets/js/generate_qrcode.js" type="text/javascript"></script>
    <script src="assets/js/script.js" type="text/javascript"></script>
    <script src="assets/js/ajax.js" type="text/javascript"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/js/all.min.js" type="text/javascript"></script>
</body>
</html>
`;

/** functions.php tryLogin() */
function loginRedirect(req: PhpRequest): Response {
  const uri = req.url.pathname + req.url.search;
  return new Response(null, { status: 302, headers: { Location: 'home.php?src=' + urlencode(uri) } });
}

export async function appUi(page: string, req: PhpRequest): Promise<Response> {
  const h = await appUiHeader(page);
  const loggedIn = h.session.id !== undefined && h.session.id !== null && s(h.session.id) !== '';
  let body = '';

  if (page === 'home.php') {
    body = `<style>
h4{
    color: white;
    z-index: 99;
}
.image-item {
    /*overflow: visible;*/
}
</style>
        <div class="banner">
                <div class="banner-text">
                    <h1>PLAYTOWN</h1>
                    <p style="font-size: 28px;">Our selections feature team games as also fun games fused with technology which makes it unique</p>
                </div>
                <div class="banner-image">
                </div>
            </div>
        <div class="games-section">
            <h2>${h.games.length} Active Games</h2>
`;
    if (h.games.length > 0) {
      body += '                <div class="image-grid">\n';
      for (const g of h.games) {
        body += `                  <div class="image-item games-grid">
                      <a href="/${s(g.game_link)}" target="black">
                        <img src="${s(g.game_image)}" alt="${s(g.game_name)}" /><br/>
                      </a>
                      <p>${s(g.game_name)}</p>
                  </div>

`;
      }
      body += '                  <!-- Add more image items as needed -->\n                </div>\n';
    }
    body += `        </div>
        <!-- Popup Overlay -->
        <div id="popupOverlay" class="overlay">
            <div class="popup">
                <!--<span class="close">&times;</span>-->
                <img src="assets/img/playtown-logo.png" width="150px" style="margin-bottom: 30px" >
                <div class="generate_otp">
                    <input type="text" id="phone" name="phone" placeholder="Enter Mobile no." required>
                    <button class="secondary-button" type="button" id="submitBtn" style="margin-bottom: 30px">GET OTP</button>
                </div>
                <div class="verify_otp" style="display:none">
                    <input type="text" id="otp" name="otp" placeholder="Enter OTP" required>
                    <button class="secondary-button" type="button" id="verify_otp_btn" style="margin-bottom: 30px">VERIFY OTP</button>
                </div>
            </div>
        </div>
    `;
    return respond(h.html + body + APP_UI_FOOTER, HTML);
  }

  if (page === 'payment.php') {
    if (!loggedIn) return loginRedirect(req);
    for (const plan of h.plans) {
      const validity = s(plan.plan_validity);
      const next = date('d M, Y', Math.floor(Date.now() / 1000) + (Number(validity) || 0) * 86400);
      body += `
        <div class="qr">
            <div class="qr-image">
                <div class="qrcode">

                </div>
               <!-- <img src="assets/img/qr.png" style="width: 100%;">-->
                <p>Scan Renew your Account</p>
            </div>

        </div>
        <div style="padding: 20px 50px;">
            <h3>Plan Validity: ${validity} Days</h3>
            <h3>Next due date: ${next}</h3>
        </div>
        <div style="padding: 20px 50px;">
            <a class="primary-button" type="button" href="payment_history.php">View Payment History</a>
        </div>
    `;
    }
    return respond(h.html + body + '\n            \n' + APP_UI_FOOTER, HTML);
  }

  if (page === 'payment_history.php') {
    if (!loggedIn) return loginRedirect(req);
    body = `
    <table>
        <tr>
            <th>Id</th>
            <th>Billing Name</th>
            <th>Plan Name</th>
            <th>Validity</th>
            <th>Billing Date</th>
            <th>Amount</th>
            <th>Payment Mode</th>
        </tr>
`;
    if (h.history.length > 0) {
      for (const p of h.history) {
        // The PHP called strtotime('d M, Y', ...), which returns false and prints nothing.
        body += `            <tr>
                <td>${s(p.id)}</td>
                <td>${s(p.billing_name)}</td>
                <td>${s(p.plan_name)}</td>
                <td>${s(p.plan_validity)}</td>
                <td></td>
                <td>${s(p.Amount)}</td>
                <td>${s(p.payment_mode)}</td>
            </tr>
`;
      }
    } else {
      body += '            <tr>\n                <td colspan="7">No Records Found</td>\n            </tr>\n';
    }
    body += '    </table>\n            \n';
    return respond(h.html + body + APP_UI_FOOTER, HTML);
  }

  if (page === 'profile.php') {
    if (!loggedIn) return loginRedirect(req);
    for (const u of h.users ?? []) {
      const devices = await user_device_list(u.id);
      body += `
        <div class="card">
            <div class="card-image">
                <img src="assets/img/ai-caricature.jpeg" style="width: 100%; border-radius: 50em;">
            </div>
            <div class="card-text">
                <h2>${ucwords(s(u.name))}</h2>
                <p style="font-size: 22px;">${u.license_no !== undefined && u.license_no !== null ? 'LIC No.' + s(u.license_no) : ''}</p>
            </div>
        </div>
        <div style="padding: 20px 50px;">
            <h3>Address: ${s(u.address)}</h3>
            <h3>Email: ${s(display_hidden_email(u.email, 7))}</h3>
            <h3>Mobile: ${display_hidden_values(u.mobileno, 6)}</h3>
            <h3>Device Id:
`;
      // $user_device->device_id reads a property of an array, which is null in PHP.
      for (let i = 0; i < devices.length; i++) body += '                <p></p>\n';
      body += '            </h3>\n        </div>\n    ';
    }
    return respond(h.html + body + '        \n' + APP_UI_FOOTER + '<script>\n    set_user_session();\n</script>', HTML);
  }

  if (page === 'tutorial.php') {
    const item = (img: string, alt: string) => `          <div class="image-item games-grid">
            <img src="assets/img/${img}" alt="${alt}" >
            <a href="videoplay.php?video=assets/video/home-page-video-loop.mp4"><img src="assets/img/play.png" class="play-icon"></a>
            <p>${alt}</p>
          </div>
`;
    body = '\n        <h2>Games Tutorial Vidoes</h2>\n        <div class="image-grid">\n'
      + item('Friendship-Tree.jpeg', 'Friendship Tree') + item('Puzzle-Hustle.jpeg', 'Puzzle Hustle')
      + item('ai-caricature.jpeg', 'AI Caricature') + item('candid-photo.jpeg', 'Candid Live')
      + item('energy-meter.jpeg', 'Energy Meter') + item('Prediction-Box.jpeg', 'Prediction Box')
      + '          <!-- Add more image items as needed -->\n        </div>\n        \n    ';
    return respond(h.html + body + APP_UI_FOOTER, HTML);
  }

  if (page === 'videoplay.php') {
    const video = req.GET.video !== undefined && req.GET.video !== null ? req.GET.video : '';
    if (empty(video)) return respond(h.html + '\nNo video specified.', HTML);
    body = `

    <video controls autoplay>
        <source src="${htmlspecialchars(video)}" type="video/mp4">
        Your browser does not support the video tag.
    </video>

    `;
    return respond(h.html + body + APP_UI_FOOTER, HTML);
  }

  return respond('Not Found', 'text/plain', 404);
}

// ---------------------------------------------------------------------------
// admin/login.php
// ---------------------------------------------------------------------------

const LOGIN_PAGE = (error: string | null) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <title>Login</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * {
            box-sizing: border-box;
            font-family: Arial, sans-serif;
        }
        body {
            background: #f4f4f4;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
        .login-container {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.1);
            width: 350px;
            text-align: center;
        }
        h2 {
            margin-bottom: 20px;
            color: #333;
        }
        input {
            width: 100%;
            padding: 10px;
            margin: 8px 0;
            border: 1px solid #ccc;
            border-radius: 5px;
            font-size: 16px;
        }
        .login-btn {
            width: 100%;
            padding: 10px;
            background: #3498db;
            border: none;
            color: white;
            font-size: 18px;
            border-radius: 5px;
            cursor: pointer;
            transition: 0.3s;
        }
        .login-btn:hover {
            background: #2980b9;
        }
        .error {
            color: red;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <h2>Login</h2>
        ${error ? `<p class='error'>${error}</p>` : ''}
        <form method="POST">
            <input type="text" name="username" placeholder="Username" required>
            <input type="password" name="password" placeholder="Password" required>
            <button type="submit" class="login-btn">Login</button>
        </form>
    </div>
</body>
</html>`;

export async function adminLogin(req: PhpRequest): Promise<Response> {
  if (req.method === 'POST') {
    const username = s(req.POST.username).trim();
    const password = s(req.POST.password).trim();
    if (ADMIN_LOGIN.password !== '' && username === ADMIN_LOGIN.username && password === ADMIN_LOGIN.password) {
      const session = await getSession();
      session.user = username;
      await session.save();
      return new Response(null, { status: 302, headers: { Location: 'human_chain_approval_json.php' } });
    }
    return respond(LOGIN_PAGE('Invalid username or password!'), HTML);
  }
  return respond(LOGIN_PAGE(null), HTML);
}
