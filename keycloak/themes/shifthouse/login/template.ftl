<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html dir="rtl" lang="he" class="${properties.kcHtmlClass!}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${msg("loginTitle")} · בקרת בדיקות</title>
  <#list properties.styles?split(' ') as style>
    <link rel="stylesheet" href="${url.resourcesPath}/${style}">
  </#list>
</head>
<body class="${properties.kcBodyClass!}">
  <div class="sh-stage">

    <#-- ===== dark brand panel (desktop only) ===== -->
    <aside class="sh-panel">
      <div class="ring1"></div>
      <div class="ring2"></div>
      <div class="brand">
        <div class="mark"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
        <span class="name">בקרת בדיקות</span>
      </div>
      <div class="headline">
        <h2>כניסה מאובטחת<br>למערכת הבדיקות.</h2>
        <p>ניהול בדיקות, פריטים והרשאות — במקום אחד, בתוך הרשת הפנימית של המפעל.</p>
      </div>
      <div class="trust">
        <div class="row"><span class="ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span><span class="txt">רשת פנימית סגורה — ללא חיבור לאינטרנט</span></div>
        <div class="row"><span class="ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span><span class="txt">הרשאות לפי תפקיד — מנהל · בודק · מחסנאי</span></div>
        <div class="row"><span class="ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span><span class="txt">גישה מורשית בלבד — ניהול משתמשים מרוכז</span></div>
      </div>
    </aside>

    <#-- ===== form column ===== -->
    <div class="sh-form-col">
      <div class="sh-shell">
        <div class="sh-mobile-brand">
          <div class="mark"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
          <div style="text-align:center">
            <div style="font-size:21px;font-weight:700;letter-spacing:-0.4px">בקרת בדיקות</div>
            <div style="font-size:13.5px;color:#7a7a7a;margin-top:3px">מערכת ניהול בדיקות ופריטים</div>
          </div>
        </div>
        <div class="sh-card">
          <#-- general error / lockout banner -->
          <#if displayMessage && message?? && message.type == 'error'>
            <div class="sh-banner">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
              <span>${kcSanitize(message.summary)?no_esc}</span>
            </div>
          </#if>
          <#nested "form">
        </div>
        <div class="sh-foot">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>רשת פנימית מאובטחת · גישה מורשית בלבד</span>
        </div>
      </div>
    </div>

  </div>
</body>
</html>
</#macro>
