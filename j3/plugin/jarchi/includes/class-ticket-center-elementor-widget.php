<?php
namespace WPEventPublisher;
if ( ! defined( 'ABSPATH' ) ) { exit; }
if ( ! class_exists( '\Elementor\Widget_Base' ) ) { return; }

class TicketCenterElementorWidget extends \Elementor\Widget_Base {
    public function get_name(): string { return 'jarchi_ticket_center'; }
    public function get_title(): string { return __( 'مرکز تیکت جارچی', 'wp-event-publisher' ); }
    public function get_icon(): string { return 'eicon-commenting'; }
    public function get_categories(): array { return array( 'general' ); }
    public function get_keywords(): array { return array( 'jarchi', 'tickets', 'support', 'تیکت', 'پشتیبانی' ); }

    public function get_style_depends(): array { return array( 'wpep-tickets' ); }

    protected function register_controls(): void {
        $this->start_controls_section( 'content', array(
            'label' => __( 'محتوا', 'wp-event-publisher' ),
            'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
        ) );

        $controls = array(
            'kicker' => array( 'برچسب بالای عنوان', 'پشتیبانی جارچی' ),
            'title' => array( 'عنوان اصلی', 'تیکت‌های من' ),
            'description' => array( 'توضیح زیر عنوان', 'سریع پیام بده، تصویر بفرست و پاسخ را همینجا دریافت کن.' ),
            'new_button_text' => array( 'متن دکمه تیکت جدید', 'تیکت جدید' ),
            'empty_list_text' => array( 'متن لیست خالی', 'هنوز تیکتی ثبت نکرده‌اید.' ),
            'faq_title' => array( 'عنوان سوالات متداول', 'قبل از ثبت تیکت' ),
            'faq_description' => array( 'توضیح سوالات متداول', 'ممکن است پاسخ شما همین‌جا باشد.' ),
            'faq_continue_text' => array( 'متن دکمه ادامه ثبت تیکت', 'مشکلم حل نشد؛ ثبت تیکت' ),
            'form_icon_title' => array( 'عنوان فرم تیکت جدید', 'تیکت جدید' ),
            'form_description' => array( 'توضیح فرم تیکت جدید', 'موضوع را کوتاه و واضح بنویس و در صورت نیاز عکس را هم ضمیمه کن.' ),
            'subject_label' => array( 'برچسب موضوع', 'موضوع' ),
            'department_label' => array( 'برچسب دپارتمان', 'دپارتمان' ),
            'priority_label' => array( 'برچسب اولویت', 'اولویت' ),
            'message_label' => array( 'برچسب پیام', 'پیام' ),
            'submit_text' => array( 'متن دکمه ثبت تیکت', 'ثبت تیکت' ),
            'upload_text' => array( 'متن ضمیمه تصویر', 'افزودن تصویر' ),
            'upload_note' => array( 'متن توضیح آپلود', 'حداکثر ۴ تصویر، هر تصویر تا ۸ مگابایت.' ),
            'reply_placeholder' => array( 'Placeholder پاسخ', 'پاسخ خود را بنویسید…' ),
            'reply_text' => array( 'متن دکمه ارسال پاسخ', 'ارسال پاسخ' ),
            'attach_text' => array( 'متن افزودن تصویر در پاسخ', 'افزودن تصویر' ),
        );
        foreach ( $controls as $key => $data ) {
            $this->add_control( $key, array(
                'label' => __( $data[0], 'wp-event-publisher' ),
                'type' => \Elementor\Controls_Manager::TEXT,
                'default' => __( $data[1], 'wp-event-publisher' ),
            ) );
        }

        $this->add_control( 'category_mode', array(
            'label' => __( 'دسته‌بندی در فرم', 'wp-event-publisher' ),
            'type' => \Elementor\Controls_Manager::SELECT,
            'default' => 'inherit',
            'options' => array(
                'inherit' => __( 'پیروی از تنظیمات جارچی', 'wp-event-publisher' ),
                'show'    => __( 'نمایش', 'wp-event-publisher' ),
                'hide'    => __( 'مخفی', 'wp-event-publisher' ),
            ),
            'description' => __( 'دسته‌بندی به‌صورت پیش‌فرض مخفی است؛ فقط اگر برای این طراحی لازم است آن را نمایش دهید.', 'wp-event-publisher' ),
        ) );
        $this->add_control( 'category_label', array(
            'label' => __( 'برچسب دسته‌بندی', 'wp-event-publisher' ),
            'type' => \Elementor\Controls_Manager::TEXT,
            'default' => __( 'دسته‌بندی', 'wp-event-publisher' ),
            'condition' => array( 'category_mode' => 'show' ),
        ) );

        $this->add_control( 'view', array(
            'label' => __( 'نمای شروع در همین صفحه', 'wp-event-publisher' ),
            'type' => \Elementor\Controls_Manager::SELECT,
            'default' => 'list',
            'options' => array(
                'list' => __( 'تیکت‌های من', 'wp-event-publisher' ),
                'new'  => __( 'سوالات متداول / ثبت تیکت', 'wp-event-publisher' ),
            ),
        ) );
        $this->end_controls_section();

        $this->start_controls_section( 'colors', array(
            'label' => __( 'رنگ‌ها', 'wp-event-publisher' ),
            'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
        ) );
        $colors = array(
            'primary' => array( 'رنگ اصلی', '#E84F01' ),
            'primary_hi' => array( 'رنگ روشن اصلی', '#FF8A1C' ),
            'surface' => array( 'رنگ کارت', '#FFFFFF' ),
            'background' => array( 'پس‌زمینه', '#F6F7F9' ),
            'text' => array( 'رنگ متن', '#171717' ),
            'muted' => array( 'متن کمکی', '#68717C' ),
            'border' => array( 'رنگ حاشیه', '#E5E7EB' ),
            'field_bg' => array( 'پس‌زمینه فیلدها', '#FFFFFF' ),
            'field_text' => array( 'متن فیلدها', '#171717' ),
            'button_text' => array( 'متن دکمه‌ها', '#FFFFFF' ),
            'badge_bg' => array( 'پس‌زمینه Badge', '#D92D20' ),
            'badge_text' => array( 'متن Badge', '#FFFFFF' ),
            'soft_bg' => array( 'پس‌زمینه ملایم', '#FFF4EA' ),
            'message_bg' => array( 'پس‌زمینه پیام', '#F6F7F9' ),
            'user_message_bg' => array( 'پس‌زمینه پیام کاربر', '#FFF5EC' ),
        );
        foreach ( $colors as $key => $data ) {
            $this->add_control( $key, array(
                'label' => __( $data[0], 'wp-event-publisher' ),
                'type' => \Elementor\Controls_Manager::COLOR,
                'default' => $data[1],
            ) );
        }
        $filter_colors = array(
            'filter_all' => array( 'رنگ وضعیت همه', '#64748B' ),
            'filter_waiting' => array( 'رنگ در انتظار پاسخ', '#D97706' ),
            'filter_reviewing' => array( 'رنگ در حال بررسی', '#7C3AED' ),
            'filter_answered' => array( 'رنگ پاسخ داده شده', '#15803D' ),
            'filter_closed' => array( 'رنگ بسته شده', '#475569' ),
        );
        foreach ( $filter_colors as $key => $data ) {
            $this->add_control( $key, array(
                'label' => __( $data[0], 'wp-event-publisher' ),
                'type' => \Elementor\Controls_Manager::COLOR,
                'default' => $data[1],
            ) );
        }
        $this->end_controls_section();

        $this->start_controls_section( 'ticket_list_style', array(
            'label' => __( 'لیست تیکت‌ها', 'wp-event-publisher' ),
            'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
        ) );
        $list_colors = array(
            'ticket_subject'   => array( 'رنگ موضوع تیکت', '#374151' ),
            'ticket_meta'      => array( 'رنگ اطلاعات ردیف', '#4B5563' ),
            'ticket_head_bg'   => array( 'پس‌زمینه سربرگ جدول', '#F8FAFC' ),
            'ticket_head_text' => array( 'متن سربرگ جدول', '#6B7280' ),
            'ticket_row_bg'    => array( 'پس‌زمینه ردیف', '#FFFFFF' ),
            'ticket_row_hover' => array( 'پس‌زمینه ردیف در Hover', '#F9FAFB' ),
        );
        foreach ( $list_colors as $key => $data ) {
            $this->add_control( $key, array(
                'label'   => __( $data[0], 'wp-event-publisher' ),
                'type'    => \Elementor\Controls_Manager::COLOR,
                'default' => $data[1],
            ) );
        }
        $this->add_responsive_control( 'ticket_row_padding', array(
            'label' => __( 'فاصله داخلی ردیف', 'wp-event-publisher' ),
            'type' => \Elementor\Controls_Manager::SLIDER,
            'size_units' => array( 'px' ),
            'range' => array( 'px' => array( 'min' => 6, 'max' => 24 ) ),
            'default' => array( 'unit' => 'px', 'size' => 10 ),
        ) );
        $this->add_responsive_control( 'ticket_table_radius', array(
            'label' => __( 'گردی جدول', 'wp-event-publisher' ),
            'type' => \Elementor\Controls_Manager::SLIDER,
            'size_units' => array( 'px' ),
            'range' => array( 'px' => array( 'min' => 0, 'max' => 28 ) ),
            'default' => array( 'unit' => 'px', 'size' => 14 ),
        ) );
        $this->add_responsive_control( 'ticket_subject_size', array(
            'label' => __( 'اندازه موضوع تیکت', 'wp-event-publisher' ),
            'type' => \Elementor\Controls_Manager::SLIDER,
            'size_units' => array( 'px' ),
            'range' => array( 'px' => array( 'min' => 10, 'max' => 22 ) ),
            'default' => array( 'unit' => 'px', 'size' => 13 ),
        ) );
        $this->add_responsive_control( 'ticket_meta_size', array(
            'label' => __( 'اندازه اطلاعات ردیف', 'wp-event-publisher' ),
            'type' => \Elementor\Controls_Manager::SLIDER,
            'size_units' => array( 'px' ),
            'range' => array( 'px' => array( 'min' => 9, 'max' => 18 ) ),
            'default' => array( 'unit' => 'px', 'size' => 11.5 ),
        ) );
        $this->add_responsive_control( 'ticket_head_size', array(
            'label' => __( 'اندازه متن سربرگ جدول', 'wp-event-publisher' ),
            'type' => \Elementor\Controls_Manager::SLIDER,
            'size_units' => array( 'px' ),
            'range' => array( 'px' => array( 'min' => 9, 'max' => 16 ) ),
            'default' => array( 'unit' => 'px', 'size' => 10.5 ),
        ) );
        $this->end_controls_section();

        $this->start_controls_section( 'layout', array(
            'label' => __( 'چیدمان', 'wp-event-publisher' ),
            'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
        ) );
        $this->add_responsive_control( 'max_width', array(
            'label' => __( 'حداکثر عرض', 'wp-event-publisher' ),
            'type' => \Elementor\Controls_Manager::SLIDER,
            'size_units' => array( 'px', '%' ),
            'range' => array( 'px' => array( 'min' => 320, 'max' => 1600 ), '%' => array( 'min' => 50, 'max' => 100 ) ),
            'default' => array( 'unit' => 'px', 'size' => 1180 ),
        ) );
        $this->add_responsive_control( 'list_width', array(
            'label' => __( 'عرض ستون لیست', 'wp-event-publisher' ),
            'type' => \Elementor\Controls_Manager::SLIDER,
            'size_units' => array( 'px' ),
            'range' => array( 'px' => array( 'min' => 220, 'max' => 420 ) ),
            'default' => array( 'unit' => 'px', 'size' => 300 ),
        ) );
        $this->add_responsive_control( 'radius', array(
            'label' => __( 'گردی گوشه‌ها', 'wp-event-publisher' ),
            'type' => \Elementor\Controls_Manager::SLIDER,
            'size_units' => array( 'px' ),
            'range' => array( 'px' => array( 'min' => 8, 'max' => 32 ) ),
            'default' => array( 'unit' => 'px', 'size' => 18 ),
        ) );
        $this->add_responsive_control( 'heading_size', array(
            'label' => __( 'اندازه عنوان صفحه', 'wp-event-publisher' ),
            'type' => \Elementor\Controls_Manager::SLIDER,
            'size_units' => array( 'px' ),
            'range' => array( 'px' => array( 'min' => 16, 'max' => 42 ) ),
            'default' => array( 'unit' => 'px', 'size' => 24 ),
        ) );
        $this->add_control( 'shadow', array(
            'label' => __( 'سایه کارت‌ها', 'wp-event-publisher' ),
            'type' => \Elementor\Controls_Manager::SWITCHER,
            'default' => 'yes',
        ) );
        $this->end_controls_section();

        $this->start_controls_section( 'typography', array(
            'label' => __( 'تایپوگرافی', 'wp-event-publisher' ),
            'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
        ) );
        $typography_controls = array(
            'title' => array(
                'label' => 'عنوان‌ها',
                'selector' => '{{WRAPPER}} .jarchi-ticket-simple-head h2, {{WRAPPER}} .jarchi-ticket-head h2, {{WRAPPER}} .jarchi-ticket-thread-head h3, {{WRAPPER}} .jarchi-ticket-form-card h3',
            ),
            'body' => array(
                'label' => 'متن و توضیحات',
                'selector' => '{{WRAPPER}} .jarchi-ticket-head p, {{WRAPPER}} .jarchi-ticket-form-card>p, {{WRAPPER}} .jarchi-ticket-message__body, {{WRAPPER}} .jarchi-ticket-empty',
            ),
            'button' => array(
                'label' => 'متن دکمه‌ها',
                'selector' => '{{WRAPPER}} .jarchi-ticket-new, {{WRAPPER}} .jarchi-ticket-submit',
            ),
            'ticket_subject' => array(
                'label' => 'موضوع تیکت در لیست',
                'selector' => '{{WRAPPER}} .jarchi-ticket-list-title strong',
            ),
            'ticket_meta' => array(
                'label' => 'اطلاعات ردیف تیکت',
                'selector' => '{{WRAPPER}} .jarchi-ticket-list-details b, {{WRAPPER}} .jarchi-ticket-list-details time, {{WRAPPER}} .jarchi-ticket-chip',
            ),
        );
        foreach ( $typography_controls as $key => $data ) {
            $this->add_group_control( \Elementor\Group_Control_Typography::get_type(), array(
                'name' => 'typography_' . $key,
                'label' => __( $data['label'], 'wp-event-publisher' ),
                'selector' => $data['selector'],
            ) );
        }
        $this->end_controls_section();
    }


    protected function render(): void {
        if ( ! function_exists( 'wpep' ) || ! is_user_logged_in() ) {
            return;
        }

        $settings = $this->get_settings_for_display();
        $overrides = array();

        foreach ( array( 'kicker','title','description','new_button_text','empty_list_text','faq_title','faq_description','faq_continue_text','form_icon_title','form_description','subject_label','department_label','category_label','priority_label','message_label','submit_text','upload_text','upload_note','reply_placeholder','reply_text','attach_text' ) as $key ) {
            if ( isset( $settings[ $key ] ) && '' !== trim( (string) $settings[ $key ] ) ) {
                $overrides[ $key ] = (string) $settings[ $key ];
            }
        }

        /*
         * Tickets::sanitize_css_color(), not sanitize_hex_color(). The latter
         * accepts only #RGB and #RRGGBB, so every colour picked from
         * Elementor's Global Colours row — or through the alpha slider — came
         * back null and was silently replaced by the default. From the
         * customer's side that is a colour control that does nothing.
         */
        foreach ( array( 'primary','primary_hi','surface','background','text','muted','border','field_bg','field_text','button_text','badge_bg','badge_text','soft_bg','message_bg','user_message_bg','ticket_subject','ticket_meta','ticket_head_bg','ticket_head_text','ticket_row_bg','ticket_row_hover' ) as $key ) {
            if ( isset( $settings[ $key ] ) && '' !== (string) $settings[ $key ] ) {
                $color = Tickets::sanitize_css_color( $settings[ $key ] );
                if ( '' !== $color ) {
                    $overrides[ $key ] = $color;
                }
            }
        }

        foreach ( array( 'max_width','list_width','radius','heading_size','ticket_row_padding','ticket_table_radius','ticket_subject_size','ticket_meta_size','ticket_head_size' ) as $key ) {
            if ( isset( $settings[ $key ]['size'] ) && '' !== (string) $settings[ $key ]['size'] ) {
                $overrides[ $key ] = array(
                    'size' => (float) $settings[ $key ]['size'],
                    'unit' => $settings[ $key ]['unit'] ?? 'px',
                );
            }
        }
        $category_mode = (string) ( $settings['category_mode'] ?? 'inherit' );
        if ( 'show' === $category_mode ) {
            $overrides['show_category'] = true;
        } elseif ( 'hide' === $category_mode ) {
            $overrides['show_category'] = false;
        }
        $overrides['view'] = in_array( (string) ( $settings['view'] ?? 'list' ), array( 'list', 'new' ), true ) ? (string) $settings['view'] : 'list';
        // The widget is an embedded application, not a link to a Jarchi-owned page.
        // Every navigation/form action returns to the exact JetEngine/Elementor page
        // in which the designer placed this widget.
        $overrides['embedded'] = true;
        $overrides['base_url'] = wpep()->tickets()->current_embed_url();
        $overrides['shadow'] = 'yes' === ( $settings['shadow'] ?? 'yes' );
        foreach ( array( 'filter_all','filter_waiting','filter_reviewing','filter_answered','filter_closed' ) as $key ) {
            if ( isset( $settings[ $key ] ) ) { $color = Tickets::sanitize_css_color( $settings[ $key ] ); if ( '' !== $color ) { $overrides[ $key ] = $color; } }
        }

        $widget_id = 'jarchi-ticket-widget-' . preg_replace( '/[^a-zA-Z0-9_-]/', '', $this->get_id() );
        $html      = wpep()->tickets()->render_center( $overrides );
        $html      = preg_replace( '/class="jarchi-ticket-center/', 'class="' . esc_attr( $widget_id ) . ' jarchi-ticket-center', $html, 1 );

        $style_values = array(
            '--jt-primary' => $overrides['primary'] ?? '#E84F01',
            '--jt-primary-hi' => $overrides['primary_hi'] ?? '#FF8A1C',
            '--jt-surface' => $overrides['surface'] ?? '#FFFFFF',
            '--jt-bg' => $overrides['background'] ?? '#F6F7F9',
            '--jt-text' => $overrides['text'] ?? '#171717',
            '--jt-muted' => $overrides['muted'] ?? '#68717C',
            '--jt-border' => $overrides['border'] ?? '#E5E7EB',
            '--jt-field-bg' => $overrides['field_bg'] ?? '#FFFFFF',
            '--jt-field-text' => $overrides['field_text'] ?? '#171717',
            '--jt-button-text' => $overrides['button_text'] ?? '#FFFFFF',
            '--jt-badge-bg' => $overrides['badge_bg'] ?? '#D92D20',
            '--jt-badge-text' => $overrides['badge_text'] ?? '#FFFFFF',
            '--jt-soft-bg' => $overrides['soft_bg'] ?? '#FFF4EA',
            '--jt-message-bg' => $overrides['message_bg'] ?? '#F6F7F9',
            '--jt-user-message-bg' => $overrides['user_message_bg'] ?? '#FFF5EC',
            '--jt-ticket-subject' => $overrides['ticket_subject'] ?? '#374151',
            '--jt-ticket-meta' => $overrides['ticket_meta'] ?? '#4B5563',
            '--jt-ticket-head-bg' => $overrides['ticket_head_bg'] ?? '#F8FAFC',
            '--jt-ticket-head-text' => $overrides['ticket_head_text'] ?? '#6B7280',
            '--jt-ticket-row-bg' => $overrides['ticket_row_bg'] ?? '#FFFFFF',
            '--jt-ticket-row-hover' => $overrides['ticket_row_hover'] ?? '#F9FAFB',
            '--jt-ticket-row-padding' => isset( $overrides['ticket_row_padding']['size'] ) ? ( (float) $overrides['ticket_row_padding']['size'] . ( $overrides['ticket_row_padding']['unit'] ?? 'px' ) ) : '10px',
            '--jt-ticket-table-radius' => isset( $overrides['ticket_table_radius']['size'] ) ? ( (float) $overrides['ticket_table_radius']['size'] . ( $overrides['ticket_table_radius']['unit'] ?? 'px' ) ) : '14px',
            '--jt-ticket-subject-size' => isset( $overrides['ticket_subject_size']['size'] ) ? ( (float) $overrides['ticket_subject_size']['size'] . ( $overrides['ticket_subject_size']['unit'] ?? 'px' ) ) : '13px',
            '--jt-ticket-meta-size' => isset( $overrides['ticket_meta_size']['size'] ) ? ( (float) $overrides['ticket_meta_size']['size'] . ( $overrides['ticket_meta_size']['unit'] ?? 'px' ) ) : '11.5px',
            '--jt-ticket-head-size' => isset( $overrides['ticket_head_size']['size'] ) ? ( (float) $overrides['ticket_head_size']['size'] . ( $overrides['ticket_head_size']['unit'] ?? 'px' ) ) : '10.5px',
            '--jt-heading-size' => isset( $overrides['heading_size']['size'] ) ? ( (float) $overrides['heading_size']['size'] . ( $overrides['heading_size']['unit'] ?? 'px' ) ) : '24px',
        );

        $css = '.' . $widget_id . '{';
        foreach ( $style_values as $key => $value ) {
            $css .= $key . ':' . esc_attr( $value ) . '!important;';
        }
        $css .= '}';
        $css .= '.'. $widget_id . ' .jarchi-ticket-new,.'. $widget_id . ' .jarchi-ticket-submit{background:linear-gradient(135deg,var(--jt-primary-hi),var(--jt-primary))!important;color:var(--jt-button-text)!important;}';
        $css .= '.'. $widget_id . ' input[type=text],.'. $widget_id . ' textarea,.'. $widget_id . ' select{background:var(--jt-field-bg)!important;color:var(--jt-field-text)!important;border-color:var(--jt-border)!important;}';
        $css .= '.'. $widget_id . ' .jarchi-ticket-head h2,.'. $widget_id . ' .jarchi-ticket-thread-head h3,.'. $widget_id . ' .jarchi-ticket-form-card h3{color:var(--jt-text)!important;}';
        $css .= '.'. $widget_id . ' .jarchi-ticket-head p,.'. $widget_id . ' .jarchi-ticket-form-card>p,.'. $widget_id . ' .jarchi-ticket-list-main small,.'. $widget_id . ' .jarchi-ticket-empty{color:var(--jt-muted)!important;}';
        $css .= '.'.$widget_id.' .jarchi-ticket-filter.is-all{--filter-accent:'.esc_attr($overrides['filter_all']??'#64748B').'!important}.'.$widget_id.' .jarchi-ticket-filter.is-waiting{--filter-accent:'.esc_attr($overrides['filter_waiting']??'#D97706').'!important}.'.$widget_id.' .jarchi-ticket-filter.is-reviewing{--filter-accent:'.esc_attr($overrides['filter_reviewing']??'#7C3AED').'!important}.'.$widget_id.' .jarchi-ticket-filter.is-answered{--filter-accent:'.esc_attr($overrides['filter_answered']??'#15803D').'!important}.'.$widget_id.' .jarchi-ticket-filter.is-closed{--filter-accent:'.esc_attr($overrides['filter_closed']??'#475569').'!important}';
        $css .= '.'.$widget_id.' .jarchi-ticket-filter.is-active{background:color-mix(in srgb,var(--filter-accent) 12%,var(--jt-surface))!important;color:var(--filter-accent)!important;border-color:var(--filter-accent)!important}.'.$widget_id.' .jarchi-ticket-status--waiting{background:color-mix(in srgb,var(--filter-waiting) 12%,var(--jt-surface))!important;color:var(--filter-waiting)!important}.'.$widget_id.' .jarchi-ticket-status--reviewing{background:color-mix(in srgb,var(--filter-reviewing) 12%,var(--jt-surface))!important;color:var(--filter-reviewing)!important}.'.$widget_id.' .jarchi-ticket-status--answered{background:color-mix(in srgb,var(--filter-answered) 12%,var(--jt-surface))!important;color:var(--filter-answered)!important}.'.$widget_id.' .jarchi-ticket-status--closed{background:color-mix(in srgb,var(--filter-closed) 12%,var(--jt-surface))!important;color:var(--filter-closed)!important}';
        $css .= '.'.$widget_id.'{background:var(--jt-bg)!important;color:var(--jt-text)!important}.'.$widget_id.' .jarchi-ticket-list,.'.$widget_id.' .jarchi-ticket-thread,.'.$widget_id.' .jarchi-ticket-faq{background:var(--jt-surface)!important}.'.$widget_id.' .jarchi-ticket-message{background:var(--jt-message-bg)!important}.'.$widget_id.' .jarchi-ticket-message.is-user{background:var(--jt-user-message-bg)!important}';
        $css .= '.'.$widget_id.' .jarchi-ticket-simple-head h2{font-size:var(--jt-heading-size)!important}.'.$widget_id.' .jarchi-ticket-list-title strong{color:var(--jt-ticket-subject)!important;font-size:var(--jt-ticket-subject-size)!important}.'.$widget_id.' .jarchi-ticket-list-details b,.'.$widget_id.' .jarchi-ticket-list-details time{color:var(--jt-ticket-meta)!important;font-size:var(--jt-ticket-meta-size)!important}.'.$widget_id.' .jarchi-ticket-list-head{background:var(--jt-ticket-head-bg)!important;color:var(--jt-ticket-head-text)!important;font-size:var(--jt-ticket-head-size)!important}.'.$widget_id.' .jarchi-ticket-list-item{background:var(--jt-ticket-row-bg)!important}.'.$widget_id.' .jarchi-ticket-list-item:hover{background:var(--jt-ticket-row-hover)!important}.'.$widget_id.' .jarchi-ticket-list-item.has-unread{background:color-mix(in srgb,var(--jt-primary) 4.5%,var(--jt-ticket-row-bg))!important}.'.$widget_id.' .jarchi-ticket-list-item.is-active{background:color-mix(in srgb,var(--jt-primary) 6%,var(--jt-ticket-row-bg))!important}';

        // Make the root itself carry the critical design tokens. This keeps Elementor's live editor isolated from parent section/theme CSS.
        $root_style = 'background:'.esc_attr( $overrides['background'] ?? '#F6F7F9' ).'!important;color:'.esc_attr( $overrides['text'] ?? '#171717' ).'!important;--jt-primary:'.esc_attr( $overrides['primary'] ?? '#E84F01' ).';--jt-primary-hi:'.esc_attr( $overrides['primary_hi'] ?? '#FF8A1C' ).';--jt-surface:'.esc_attr( $overrides['surface'] ?? '#FFFFFF' ).';--jt-bg:'.esc_attr( $overrides['background'] ?? '#F6F7F9' ).';--jt-text:'.esc_attr( $overrides['text'] ?? '#171717' ).';--jt-muted:'.esc_attr( $overrides['muted'] ?? '#68717C' ).';--jt-border:'.esc_attr( $overrides['border'] ?? '#E5E7EB' ).';--jt-field-bg:'.esc_attr( $overrides['field_bg'] ?? '#FFFFFF' ).';--jt-field-text:'.esc_attr( $overrides['field_text'] ?? '#171717' ).';--jt-button-text:'.esc_attr( $overrides['button_text'] ?? '#FFFFFF' ).';--jt-soft-bg:'.esc_attr( $overrides['soft_bg'] ?? '#FFF4EA' ).';--jt-message-bg:'.esc_attr( $overrides['message_bg'] ?? '#F6F7F9' ).';--jt-user-message-bg:'.esc_attr( $overrides['user_message_bg'] ?? '#FFF5EC' ).';';
        /*
         * The replacement is escaped, not interpolated. preg_replace() reads
         * `$1` and `\1` in the replacement as backreferences, so a colour
         * value that happened to contain one would be substituted away — and
         * now that these values may be `var(--e-global-color-...)` rather than
         * plain hex, assuming they never can is no longer safe.
         */
        $html = preg_replace_callback(
            '/(<div id="jarchi-tickets"[^>]*style=")[^"]*(")/',
            static function ( array $m ) use ( $root_style ): string {
                return $m[1] . $root_style . $m[2];
            },
            $html,
            1
        );

        $html .= '<style class="jarchi-elementor-ticket-style">' . $css . '</style>';

        echo $html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
    }
}
