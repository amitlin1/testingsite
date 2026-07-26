<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=true; section>
  <#if section = "form">
    <h1 class="sh-title">${msg("updatePasswordTitle")}</h1>
    <div class="sh-banner sh-info" style="margin:16px 0 22px">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0066cc" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
      <span style="font-weight:400;color:#1d1d1f">${msg("updatePasswordMessage")}</span>
    </div>
    <form id="kc-passwd-update-form" action="${url.loginAction}" method="post" style="display:flex;flex-direction:column;gap:16px">
      <div>
        <label class="sh-label" for="password-new">${msg("passwordNew")}</label>
        <div class="sh-field <#if messagesPerField.existsError('password','password-confirm')>error</#if>">
          <input id="password-new" name="password-new" type="password" autofocus autocomplete="new-password" placeholder="${msg('passwordNew')}">
        </div>
        <div class="sh-sub" style="margin:6px 0 0;font-size:12px">${msg("passwordHint")}</div>
      </div>
      <div>
        <label class="sh-label" for="password-confirm">${msg("passwordConfirm")}</label>
        <div class="sh-field <#if messagesPerField.existsError('password-confirm')>error</#if>">
          <input id="password-confirm" name="password-confirm" type="password" autocomplete="new-password" placeholder="${msg('passwordConfirm')}">
        </div>
        <#if messagesPerField.existsError('password-confirm')><div class="sh-field-error">${kcSanitize(messagesPerField.get('password-confirm'))?no_esc}</div></#if>
      </div>
      <button class="sh-btn" type="submit">${msg("doUpdatePassword")}</button>
    </form>
  </#if>
</@layout.registrationLayout>
