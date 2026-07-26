<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=true; section>
  <#if section = "form">
    <h1 class="sh-title">${msg("loginTitle")}</h1>
    <p class="sh-sub">${msg("loginSubtitle")}</p>
    <form id="kc-form-login" action="${url.loginAction}" method="post" style="display:flex;flex-direction:column;gap:16px">
      <div>
        <label class="sh-label" for="username">${msg("usernameOrEmail")}</label>
        <div class="sh-field <#if messagesPerField.existsError('username','password')>error</#if>">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9a9aa0" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <input id="username" name="username" type="text" autofocus autocomplete="username" value="${(login.username!'')}" placeholder="${msg('usernameOrEmail')}">
        </div>
        <#if messagesPerField.existsError('username')><div class="sh-field-error">${msg('missingUsernameMessage')}</div></#if>
      </div>
      <div>
        <label class="sh-label" for="password">${msg("password")}</label>
        <div class="sh-field <#if messagesPerField.existsError('username','password')>error</#if>">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9a9aa0" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <input id="password" name="password" type="password" autocomplete="current-password" placeholder="${msg('password')}">
          <button type="button" onclick="var p=document.getElementById('password');p.type=p.type==='password'?'text':'password'" style="border:0;background:transparent;color:#7a7a7a;cursor:pointer;padding:4px;display:flex" aria-label="הצג/הסתר סיסמה">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <#if messagesPerField.existsError('password')><div class="sh-field-error">${msg('missingPasswordMessage')}</div></#if>
      </div>
      <button class="sh-btn" name="login" id="kc-login" type="submit"
        onclick="this.setAttribute('disabled','');this.innerHTML='מתחבר…';this.form.submit();">${msg("doLogIn")}</button>
    </form>
  </#if>
</@layout.registrationLayout>
