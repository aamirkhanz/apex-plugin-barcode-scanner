-- Barcode Scanner item plug-in (TechRevX, www.techrevx.com)
-- render: a text field (users can also type the code) and a Scan button; techrevx.barcodeScanner.init
--         (barcode-scanner.js) opens the camera in a dialog and reads codes with barcode-detector / ZXing (MIT).

procedure render (
    p_item   in            apex_plugin.t_item,
    p_plugin in            apex_plugin.t_plugin,
    p_param  in            apex_plugin.t_item_render_param,
    p_result in out nocopy apex_plugin.t_item_render_result )
is
    l_id    varchar2( 255 ) := apex_escape.html_attribute( p_item.name );
    l_label varchar2( 4000 ) := nvl( p_item.attributes.get_varchar2( 'BUTTON_LABEL' ), 'Scan' );
begin
    if p_param.is_readonly or p_param.is_printer_friendly then
        sys.htp.p( '<span class="display_only apex-item-display-only" id="' || l_id || '_DISPLAY">' || apex_escape.html( p_param.value ) || '</span>' );
        apex_plugin_util.print_hidden_if_readonly( p_item => p_item, p_param => p_param );
        return;
    end if;

    sys.htp.p( '<input type="text" id="' || l_id || '" name="' || apex_plugin.get_input_name_for_item || '"'
        || ' class="text_field apex-item-text tx-Scan-input' || case when p_item.element_css_classes is not null then ' ' || apex_escape.html_attribute( p_item.element_css_classes ) end || '"'
        || ' value="' || apex_escape.html_attribute( p_param.value ) || '"'
        || case when p_item.element_width is not null then ' size="' || p_item.element_width || '"' end
        || case when p_item.element_max_length is not null then ' maxlength="' || p_item.element_max_length || '"' end
        || case when p_item.placeholder is not null then ' placeholder="' || apex_escape.html_attribute( p_item.placeholder ) || '"' end
        || case when p_item.is_required then ' required' end
        || ' autocomplete="off" spellcheck="false"'
        || case when p_item.element_attributes is not null then ' ' || p_item.element_attributes end
        || '>' );
    sys.htp.p( '<button type="button" class="tx-Scan-btn" id="' || l_id || '_scan" aria-haspopup="dialog">'
        || '<span class="fa fa-qrcode" aria-hidden="true"></span><span class="tx-Scan-btnText">' || apex_escape.html( l_label ) || '</span></button>' );

    apex_javascript.add_onload_code( p_code =>
        'techrevx.barcodeScanner.init(' || apex_javascript.add_value( p_item.name ) || '{'
        || apex_javascript.add_attribute( 'formats', p_item.attributes.get_varchar2( 'FORMATS' ) )
        || apex_javascript.add_attribute( 'afterScan', p_item.attributes.get_varchar2( 'AFTER_SCAN' ) )
        || apex_javascript.add_attribute( 'feedback', p_item.attributes.get_varchar2( 'FEEDBACK' ) )
        || apex_javascript.add_attribute( 'camera', p_item.attributes.get_varchar2( 'CAMERA' ) )
        || apex_javascript.add_attribute( 'features', p_item.attributes.get_varchar2( 'FEATURES' ) )
        || apex_javascript.add_attribute( 'label', l_label )
        || apex_javascript.add_attribute( 'filePrefix', p_plugin.file_prefix, false, false )
        || '}, ' || nvl( p_item.init_javascript_code, 'null' ) || ');' );

    p_result.is_navigable := true;
end render;
