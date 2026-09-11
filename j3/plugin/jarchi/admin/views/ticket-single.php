<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
$back = WPEventPublisher\Admin::app_url( 'support' );
?>
<div class="wrap wpep-wrap wpep-ticket-admin" dir="rtl">
	<div class="jarchi-admin-ticket-layout">
		<section class="wpep-card jarchi-admin-ticket-main">
			<div class="wpep-card__head"><div><a href="<?php echo esc_url( $back ); ?>" class="jarchi-ticket-back">← <?php esc_html_e( 'بازگشت به تیکت‌ها', 'wp-event-publisher' ); ?></a><h2 class="wpep-card__title"><?php echo esc_html( $ticket->post_title ); ?></h2><p class="wpep-card__hint">#<?php echo esc_html( (string) $ticket_id ); ?></p></div><span class="wpep-pill wpep-pill--<?php echo 'closed' === $status ? 'muted' : ( 'reviewing' === $status ? 'warning' : ( 'waiting' === $status ? 'danger' : 'success' ) ); ?>"><?php echo esc_html( wpep()->tickets()->status_label( $status ) ); ?></span></div>
			<div class="wpep-ticket-thread-admin">
			<?php foreach ( $messages as $message ) : $sender = (string) get_comment_meta( $message->comment_ID, '_jarchi_ticket_sender', true ); ?>
				<article class="wpep-ticket-message-admin <?php echo 'user' === $sender ? 'is-user' : ''; ?>"><div class="wpep-ticket-message-admin__meta"><strong><?php echo esc_html( get_comment_author( $message ) ); ?></strong><small><?php echo esc_html( get_comment_date( '', $message ) . ' ' . get_comment_time( '', $message ) ); ?></small></div><div class="wpep-ticket-message-admin__body"><?php echo wpautop( wp_kses_post( $message->comment_content ) ); ?></div><?php $att = wpep()->tickets()->attachments( $message->comment_ID ); if ( $att ) : ?><div class="wpep-ticket-attachments-admin">
<?php foreach ( $att as $aid ) : $url = wp_get_attachment_image_url( $aid, 'medium' ); $full = wp_get_attachment_url( $aid ); $mime = (string) get_post_mime_type( $aid ); ?>
<?php if ( $full && str_starts_with( $mime, 'audio/' ) ) : ?><audio controls preload="metadata" src="<?php echo esc_url( $full ); ?>"></audio>
<?php elseif ( $full && 'application/pdf' === $mime ) : ?><a href="<?php echo esc_url( $full ); ?>" target="_blank" rel="noopener">📎 <?php echo esc_html( get_the_title( $aid ) ?: basename( $full ) ); ?></a>
<?php elseif ( $full && $url ) : ?><a href="<?php echo esc_url( $full ); ?>" target="_blank" rel="noopener"><img src="<?php echo esc_url( $url ); ?>" alt="" /></a><?php endif; ?>
<?php endforeach; ?>
</div><?php endif; ?></article>
			<?php endforeach; ?>
			</div>
			<?php if ( 'closed' !== $status ) : ?><form class="wpep-ticket-reply" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data"><input type="hidden" name="action" value="wpep_ticket_reply" /><input type="hidden" name="ticket_id" value="<?php echo esc_attr( (string) $ticket_id ); ?>" /><input type="hidden" name="_wpnonce" value="<?php echo esc_attr( wp_create_nonce( WPEventPublisher\Tickets::NONCE ) ); ?>" /><select id="jarchi-canned-reply" style="width:100%;margin-bottom:10px"><option value="">پاسخ آماده…</option><?php foreach ( wpep()->tickets()->canned_replies() as $item ) : ?><option value="<?php echo esc_attr( base64_encode( (string) ( $item['body'] ?? '' ) ) ); ?>"><?php echo esc_html( (string) ( $item['title'] ?? '' ) ); ?></option><?php endforeach; ?></select><textarea id="jarchi-admin-reply-body" name="message" placeholder="<?php esc_attr_e( 'پاسخ خود را بنویسید…', 'wp-event-publisher' ); ?>"></textarea><div class="wpep-ticket-reply-options"><label><input type="file" name="attachments[]" accept="image/jpeg,image/png,image/webp,image/gif" multiple /> <?php esc_html_e( 'افزودن تصویر', 'wp-event-publisher' ); ?></label><label class="jarchi-ticket-sms-opt"><input type="checkbox" name="send_sms" value="1" <?php checked( wpep()->tickets_sms()->enabled() ); ?> /> <span><?php esc_html_e( 'ارسال پیامک به کاربر بعد از پاسخ', 'wp-event-publisher' ); ?></span></label></div><button type="submit" class="button button-primary"><?php esc_html_e( 'ارسال پاسخ و اطلاع کاربر', 'wp-event-publisher' ); ?></button></form><script>
(function(){
	function decodeUtf8Base64(v){
		if(!v){return '';}
		try{
			var bin=atob(v),i,bytes=new Uint8Array(bin.length);
			for(i=0;i<bin.length;i++){bytes[i]=bin.charCodeAt(i);}
			if(window.TextDecoder){return new TextDecoder('utf-8',{fatal:false}).decode(bytes);}
			var encoded='';
			for(i=0;i<bytes.length;i++){encoded += '%' + ('0'+bytes[i].toString(16)).slice(-2);}
			return decodeURIComponent(encoded);
		}catch(err){return '';}
	}
	document.addEventListener('change',function(e){
		if(e.target&&e.target.id==='jarchi-canned-reply'){
			var field=document.getElementById('jarchi-admin-reply-body');
			if(field){field.value=decodeUtf8Base64(e.target.value);}
		}
	});
}());
</script><?php endif; ?>
		</section>
		<aside class="wpep-ticket-meta-card">
			<h3 class="wpep-card__title"><?php esc_html_e( 'جزئیات تیکت', 'wp-event-publisher' ); ?></h3>
			<dl style="margin-top:14px"><dt><?php esc_html_e( 'کاربر', 'wp-event-publisher' ); ?></dt><dd><?php echo esc_html( $user ? $user->display_name : '—' ); ?></dd><dt><?php esc_html_e( 'ایمیل', 'wp-event-publisher' ); ?></dt><dd><?php echo esc_html( $user ? $user->user_email : '—' ); ?></dd><dt><?php esc_html_e( 'اولویت', 'wp-event-publisher' ); ?></dt><dd><?php echo esc_html( array( 'low' => 'کم', 'normal' => 'عادی', 'high' => 'بالا', 'urgent' => 'فوری' )[ $priority ] ?? 'عادی' ); ?></dd><dt><?php esc_html_e( 'دپارتمان', 'wp-event-publisher' ); ?></dt><dd><?php echo esc_html( ! empty( $terms ) && ! is_wp_error( $terms ) ? $terms[0]->name : '—' ); ?></dd><dt><?php esc_html_e( 'دسته‌بندی', 'wp-event-publisher' ); ?></dt><dd><?php echo esc_html( ! empty( $categories ) && ! is_wp_error( $categories ) ? $categories[0]->name : '—' ); ?></dd></dl>
			<form class="wpep-ticket-status-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"><input type="hidden" name="action" value="wpep_ticket_status" /><input type="hidden" name="ticket_id" value="<?php echo esc_attr( (string) $ticket_id ); ?>" /><input type="hidden" name="_wpnonce" value="<?php echo esc_attr( wp_create_nonce( WPEventPublisher\Tickets::NONCE ) ); ?>" /><label><?php esc_html_e( 'وضعیت', 'wp-event-publisher' ); ?><select name="status" style="width:100%;margin-top:6px"><option value="waiting" <?php selected( $status, 'waiting' ); ?>>در انتظار پاسخ</option><option value="reviewing" <?php selected( $status, 'reviewing' ); ?>>در حال بررسی</option><option value="answered" <?php selected( $status, 'answered' ); ?>>پاسخ داده شده</option><option value="closed" <?php selected( $status, 'closed' ); ?>>بسته شده</option></select></label><button type="submit" class="button" style="margin-top:10px"><?php esc_html_e( 'ذخیره وضعیت', 'wp-event-publisher' ); ?></button></form>
		<?php
		$support_agents = wpep()->tickets()->support_agents();
		$current_agent = (int) get_post_meta( $ticket_id, '_jarchi_ticket_agent', true );
		$agent_return_url = WPEventPublisher\Admin::app_url( 'support', array( 'ticket' => $ticket_id ) );
		?>
		<?php if ( isset( $_GET['jarchi_agent_updated'] ) ) : ?>
			<div class="notice notice-success inline" style="margin:14px 0 0"><p><?php esc_html_e( 'پشتیبان تیکت با موفقیت به‌روزرسانی شد.', 'wp-event-publisher' ); ?></p></div>
		<?php elseif ( isset( $_GET['jarchi_agent_error'] ) ) : ?>
			<div class="notice notice-error inline" style="margin:14px 0 0"><p><?php esc_html_e( 'پشتیبان انتخاب‌شده معتبر نیست. دوباره تلاش کنید.', 'wp-event-publisher' ); ?></p></div>
		<?php endif; ?>
		<form class="wpep-ticket-status-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:14px">
			<input type="hidden" name="action" value="wpep_ticket_assign_agent" />
			<input type="hidden" name="ticket_id" value="<?php echo esc_attr( (string) $ticket_id ); ?>" />
			<input type="hidden" name="return_url" value="<?php echo esc_attr( $agent_return_url ); ?>" />
			<input type="hidden" name="_wpnonce" value="<?php echo esc_attr( wp_create_nonce( WPEventPublisher\Tickets::NONCE ) ); ?>" />
			<label><?php esc_html_e( 'پشتیبان', 'wp-event-publisher' ); ?>
				<select name="agent" style="width:100%;margin-top:6px" <?php disabled( empty( $support_agents ) ); ?>>
					<option value="0"><?php esc_html_e( 'بدون پشتیبان', 'wp-event-publisher' ); ?></option>
					<?php foreach ( $support_agents as $agent ) : ?>
						<option value="<?php echo esc_attr( $agent->ID ); ?>" <?php selected( $current_agent, $agent->ID ); ?>><?php echo esc_html( $agent->display_name ); ?></option>
					<?php endforeach; ?>
				</select>
			</label>
			<?php if ( $support_agents ) : ?>
				<button type="submit" class="button" style="margin-top:10px"><?php esc_html_e( 'اختصاص پشتیبان', 'wp-event-publisher' ); ?></button>
			<?php else : ?>
				<p class="description" style="margin-top:8px"><?php esc_html_e( 'هنوز هیچ پشتیبانی تعریف نشده است. ابتدا یک کاربر را به‌عنوان پشتیبان جارچی اضافه کنید.', 'wp-event-publisher' ); ?></p>
				<a class="button" style="margin-top:8px" href="<?php echo esc_url( WPEventPublisher\Admin::app_url( 'ticket-agents' ) ); ?>"><?php esc_html_e( 'مدیریت پشتیبان‌ها', 'wp-event-publisher' ); ?></a>
			<?php endif; ?>
		</form></aside>
	</div>
</div>
