<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=messagesPerField.exists('global'); section>
  <#if section = "form">
    <h1 class="sh-title">${msg("updateProfileTitle")}</h1>
    <p class="sh-sub">${msg("updateProfileSubtitle")}</p>
    <form id="kc-update-profile-form" action="${url.loginAction}" method="post" style="display:flex;flex-direction:column;gap:16px">

      <#list profile.attributes as attribute>
        <#assign hasError = messagesPerField.existsError(attribute.name)>
        <div>
          <label class="sh-label" for="${attribute.name}">${advancedMsg(attribute.displayName!'')}<#if attribute.required><span class="sh-req" aria-hidden="true"> *</span></#if></label>
          <div class="sh-field<#if attribute.readOnly> readonly</#if><#if hasError> error</#if>">
            <input
              id="${attribute.name}"
              name="${attribute.name}"
              type="<#if attribute.name == 'email'>email<#else>text</#if>"
              value="${(attribute.value!'')}"
              dir="auto"
              <#if attribute.readOnly>disabled</#if>
              aria-invalid="${hasError?string('true','false')}">
          </div>
          <#if hasError>
            <div class="sh-field-error">${kcSanitize(messagesPerField.get(attribute.name))?no_esc}</div>
          </#if>
        </div>
      </#list>

      <button class="sh-btn" type="submit"
        onclick="this.setAttribute('disabled','');this.innerHTML='שומר…';this.form.submit();">${msg("doSubmit")}</button>
    </form>
  </#if>
</@layout.registrationLayout>
